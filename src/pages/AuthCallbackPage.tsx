import { useEffect, useRef } from "react";
import { useNavigate } from "react-router-dom";
import { Loader2 } from "lucide-react";
import { supabase } from "@/lib/supabase";

/**
 * Supabase redirects here after the user clicks "Confirm email" (`emailRedirectTo` on signUp / resend).
 * Tokens are in the URL hash; the client picks up the session, then we send the user to the app.
 */
export default function AuthCallbackPage() {
  const navigate = useNavigate();
  const doneRef = useRef(false);

  useEffect(() => {
    const finish = (to: string) => {
      if (doneRef.current) return;
      doneRef.current = true;
      navigate(to, { replace: true });
    };

    const failTimer = window.setTimeout(() => {
      void supabase.auth.getSession().then(({ data: { session } }) => {
        if (!session?.user && !doneRef.current) finish("/login?auth=email_link_invalid");
      });
    }, 8000);

    const { data: { subscription } } = supabase.auth.onAuthStateChange((event, session) => {
      if (
        session?.user &&
        (event === "SIGNED_IN" || event === "TOKEN_REFRESHED" || event === "INITIAL_SESSION")
      ) {
        window.clearTimeout(failTimer);
        finish("/home");
      }
    });

    void supabase.auth.getSession().then(({ data: { session } }) => {
      if (session?.user) {
        window.clearTimeout(failTimer);
        finish("/home");
      }
    });

    return () => {
      window.clearTimeout(failTimer);
      subscription.unsubscribe();
    };
  }, [navigate]);

  return (
    <div className="flex min-h-dvh flex-col items-center justify-center gap-3 bg-background px-6">
      <Loader2 className="h-10 w-10 animate-spin text-primary" />
      <p className="text-center text-sm text-muted-foreground">Verifying your email…</p>
    </div>
  );
}
