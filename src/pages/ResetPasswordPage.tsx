import { useEffect, useRef, useState } from "react";
import { useNavigate } from "react-router-dom";
import { Loader2 } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { supabase } from "@/lib/supabase";
import { useAuth } from "@/hooks/useAuth";

const MIN_PASSWORD = 8;

/**
 * Supabase redirects here from the password-recovery email (`redirectTo` on resetPasswordForEmail).
 * User arrives with a recovery session in the URL hash, sets a new password, then we sign them out
 * so they log in cleanly with the new password.
 */
export default function ResetPasswordPage() {
  const navigate = useNavigate();
  const { updatePassword, signOut } = useAuth();
  const [sessionReady, setSessionReady] = useState(false);
  const [timedOut, setTimedOut] = useState(false);
  const [password, setPassword] = useState("");
  const [confirm, setConfirm] = useState("");
  const [error, setError] = useState("");
  const [submitting, setSubmitting] = useState(false);
  const cancelled = useRef(false);

  useEffect(() => {
    let attempts = 0;
    const maxAttempts = 40;

    const tick = async () => {
      const { data: { session } } = await supabase.auth.getSession();
      if (cancelled.current) return;
      if (session?.user) {
        setSessionReady(true);
        return;
      }
      attempts += 1;
      if (attempts >= maxAttempts) {
        setTimedOut(true);
        return;
      }
      window.setTimeout(tick, 150);
    };

    void tick();

    const { data: { subscription } } = supabase.auth.onAuthStateChange((event, session) => {
      if (session?.user && (event === "SIGNED_IN" || event === "TOKEN_REFRESHED")) {
        setSessionReady(true);
      }
    });

    return () => {
      cancelled.current = true;
      subscription.unsubscribe();
    };
  }, []);

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    setError("");
    if (password.length < MIN_PASSWORD) {
      setError(`Use at least ${MIN_PASSWORD} characters`);
      return;
    }
    if (password !== confirm) {
      setError("Passwords do not match");
      return;
    }
    setSubmitting(true);
    try {
      await updatePassword(password);
      await signOut();
      navigate("/login?reset=success", { replace: true });
    } catch (err: unknown) {
      setError(err instanceof Error ? err.message : "Could not update password");
    } finally {
      setSubmitting(false);
    }
  };

  if (timedOut) {
    return (
      <div className="flex min-h-dvh flex-col items-center justify-center gap-4 bg-background px-6 text-center">
        <p className="text-lg font-semibold text-foreground">This reset link is invalid or expired</p>
        <p className="text-sm text-muted-foreground">Request a new link from the login page.</p>
        <Button onClick={() => navigate("/login", { replace: true })}>Back to login</Button>
      </div>
    );
  }

  if (!sessionReady) {
    return (
      <div className="flex min-h-dvh flex-col items-center justify-center gap-3 bg-background px-6">
        <Loader2 className="h-10 w-10 animate-spin text-primary" />
        <p className="text-sm text-muted-foreground">Preparing password reset…</p>
      </div>
    );
  }

  return (
    <div className="flex min-h-dvh flex-col items-center justify-center bg-background px-6 py-12">
      <div className="glass-strong w-full max-w-md rounded-3xl p-8">
        <h1 className="mb-2 text-center text-2xl font-bold text-foreground">Set a new password</h1>
        <p className="mb-6 text-center text-sm text-muted-foreground">Choose a strong password for your Doings account.</p>
        <form onSubmit={(e) => void handleSubmit(e)} className="space-y-4">
          <div className="space-y-2">
            <Label htmlFor="reset-pw">New password</Label>
            <Input
              id="reset-pw"
              type="password"
              autoComplete="new-password"
              value={password}
              onChange={(e) => setPassword(e.target.value)}
              placeholder={`At least ${MIN_PASSWORD} characters`}
            />
          </div>
          <div className="space-y-2">
            <Label htmlFor="reset-pw2">Confirm password</Label>
            <Input
              id="reset-pw2"
              type="password"
              autoComplete="new-password"
              value={confirm}
              onChange={(e) => setConfirm(e.target.value)}
              placeholder="Repeat password"
            />
          </div>
          {error ? <p className="text-sm text-destructive">{error}</p> : null}
          <Button type="submit" variant="hero" className="w-full" size="lg" disabled={submitting}>
            {submitting ? <Loader2 className="h-5 w-5 animate-spin" /> : "Update password"}
          </Button>
        </form>
      </div>
    </div>
  );
}
