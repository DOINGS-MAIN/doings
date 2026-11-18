import { useEffect, useState } from "react";
import { Navigate, useNavigate } from "react-router-dom";
import { KeyRound, ShieldCheck } from "lucide-react";
import { Card, CardContent } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { Button } from "@/components/ui/button";
import { supabase, admin as adminApi } from "@/lib/supabase";
import { useAdminAuth } from "@/hooks/useAdminAuth";

const PUT_OFF_KEY = "doings-admin-two-step-later";

/** A super admin chose "Not now" in this browser tab (only offered while the rule is off). */
export function twoStepPutOff(): boolean {
  try {
    return sessionStorage.getItem(PUT_OFF_KEY) === "1";
  } catch {
    return false;
  }
}

type Enrolment = { factorId: string; qr: string; secret: string };

const message = (err: unknown, fallback: string) => (err instanceof Error && err.message ? err.message : fallback);

/**
 * Two-step sign-in: asks for the authenticator code at sign-in, or walks an admin through adding an
 * authenticator app (scan the QR code, type the 6 digits). Required for super admins once the rule is
 * switched on from the Team page; anyone else may set it up for themselves.
 */
export const AdminTwoStep = () => {
  const { session, loading, logout } = useAdminAuth();
  const navigate = useNavigate();
  const [code, setCode] = useState("");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [enrolment, setEnrolment] = useState<Enrolment | null>(null);
  const [required, setRequired] = useState<boolean | null>(null);
  const [done, setDone] = useState(false);
  // Asked from the auth server as well: the session does not always carry the list of authenticators.
  const [listedFactorId, setListedFactorId] = useState<string | null | undefined>(undefined);

  useEffect(() => {
    if (!session) return;
    let cancelled = false;
    supabase.auth.mfa.listFactors().then(
      ({ data }) => !cancelled && setListedFactorId(data?.totp?.[0]?.id ?? null),
      () => !cancelled && setListedFactorId(null),
    );
    return () => {
      cancelled = true;
    };
  }, [session?.adminId]); // eslint-disable-line react-hooks/exhaustive-deps

  const factorId = session?.twoStepFactorId ?? listedFactorId ?? null;
  // An authenticator exists but the session says "setup": it is really a code that is owed.
  const state = session?.twoStep === "setup" && factorId ? "challenge" : session?.twoStep;
  const settingUp = state === "setup" || (state === "ok" && !factorId);

  // Whether "Not now" may be offered: only while the rule is off.
  useEffect(() => {
    if (!session) return;
    let cancelled = false;
    adminApi.team.accept().then(
      (res) => !cancelled && setRequired((res as { two_step_required?: boolean }).two_step_required === true),
      // Unknown: offer "Not now" rather than trap someone on this screen; the server enforces the rule.
      () => !cancelled && setRequired(false),
    );
    return () => {
      cancelled = true;
    };
  }, [session?.adminId]); // eslint-disable-line react-hooks/exhaustive-deps

  if (loading) {
    return (
      <div className="min-h-screen flex items-center justify-center bg-background">
        <p className="text-sm text-muted-foreground">Checking session…</p>
      </div>
    );
  }
  if (!session) return <Navigate to="/admin/login" replace />;

  const startSetup = async () => {
    setBusy(true);
    setError(null);
    try {
      // A setup that was started and never finished leaves an unconfirmed entry behind; clear it.
      const { data: listed } = await supabase.auth.mfa.listFactors();
      for (const f of listed?.all ?? []) {
        if (f.status !== "verified") await supabase.auth.mfa.unenroll({ factorId: f.id });
      }
      const { data, error: enrolErr } = await supabase.auth.mfa.enroll({
        factorType: "totp",
        friendlyName: `Doings admin ${new Date().toISOString().slice(0, 10)}`,
      });
      if (enrolErr || !data) throw enrolErr ?? new Error("Could not start setup");
      setEnrolment({ factorId: data.id, qr: data.totp.qr_code, secret: data.totp.secret });
      setCode("");
    } catch (err) {
      setError(message(err, "Could not start setup"));
    } finally {
      setBusy(false);
    }
  };

  const submitCode = async (e: React.FormEvent) => {
    e.preventDefault();
    const useFactor = enrolment?.factorId ?? factorId;
    if (!useFactor || code.length !== 6 || busy) return;
    setBusy(true);
    setError(null);
    try {
      const { error: verifyErr } = await supabase.auth.mfa.challengeAndVerify({ factorId: useFactor, code });
      if (verifyErr) throw new Error("That code is not right. Check the app and try the newest code.");
      if (enrolment) {
        setEnrolment(null);
        setDone(true);
      } else {
        navigate("/admin", { replace: true });
      }
    } catch (err) {
      setError(message(err, "Could not check the code"));
      setCode("");
    } finally {
      setBusy(false);
    }
  };

  const putOff = () => {
    try {
      sessionStorage.setItem(PUT_OFF_KEY, "1");
    } catch {
      // Private mode: the layout simply asks again on the next page.
    }
    navigate("/admin", { replace: true });
  };

  const codeForm = (label: string) => (
    <form onSubmit={submitCode} className="space-y-4">
      <div>
        <label className="text-sm font-medium text-muted-foreground mb-2 block">{label}</label>
        <div className="relative">
          <KeyRound className="absolute left-4 top-1/2 -translate-y-1/2 w-4 h-4 text-muted-foreground" />
          <Input
            inputMode="numeric"
            autoComplete="one-time-code"
            placeholder="123456"
            maxLength={6}
            value={code}
            onChange={(e) => setCode(e.target.value.replace(/\D/g, "").slice(0, 6))}
            className="pl-11 tracking-widest"
            autoFocus
            required
          />
        </div>
      </div>
      {error && <p className="text-sm text-destructive">{error}</p>}
      <Button type="submit" className="w-full h-12 font-semibold" disabled={busy || code.length !== 6}>
        {busy ? "Checking…" : "Continue"}
      </Button>
    </form>
  );

  let title = "Two-step sign-in";
  let subtitle = "";
  let body: React.ReactNode;

  if (listedFactorId === undefined && !session.twoStepFactorId) {
    subtitle = "Checking your sign-in…";
    body = null;
  } else if (done || (state === "ok" && factorId && !enrolment)) {
    subtitle = "Your account asks for a code from your authenticator app at every sign-in.";
    body = (
      <Button className="w-full h-12 font-semibold" onClick={() => navigate("/admin", { replace: true })}>
        {done ? "Done" : "Back to the console"}
      </Button>
    );
    title = done ? "Two-step sign-in is on" : title;
  } else if (state === "challenge" && !enrolment) {
    subtitle = "Enter the 6-digit code from your authenticator app.";
    body = (
      <>
        {codeForm("Code")}
        <p className="text-xs text-muted-foreground mt-4">
          Lost your phone? Another super admin can reset your two-step sign-in from the Team page.
        </p>
      </>
    );
  } else if (enrolment) {
    title = "Set up two-step sign-in";
    subtitle = "Scan this with an authenticator app (Google Authenticator, Authy, 1Password), then enter the code it shows.";
    body = (
      <div className="space-y-4">
        <img src={enrolment.qr} alt="QR code for your authenticator app" className="mx-auto w-48 h-48 rounded-lg bg-white p-2" />
        <p className="text-xs text-muted-foreground text-center break-all">
          Can&apos;t scan? Type this key into the app: <span className="font-mono text-foreground">{enrolment.secret}</span>
        </p>
        {codeForm("Code from the app")}
      </div>
    );
  } else if (settingUp) {
    title = "Set up two-step sign-in";
    subtitle =
      session.role === "super_admin"
        ? "Super admins sign in with a password and a code from an authenticator app. It takes a minute to set up."
        : "Add a code from an authenticator app to your sign-in. It takes a minute to set up.";
    body = (
      <div className="space-y-3">
        {error && <p className="text-sm text-destructive">{error}</p>}
        <Button className="w-full h-12 font-semibold" onClick={() => void startSetup()} disabled={busy}>
          {busy ? "Starting…" : "Set up now"}
        </Button>
        {(session.role !== "super_admin" || required === false) && (
          <Button variant="ghost" className="w-full" onClick={putOff}>
            Not now
          </Button>
        )}
      </div>
    );
  }

  return (
    <div className="min-h-screen flex items-center justify-center bg-background p-4" style={{ background: "var(--gradient-hero)" }}>
      <Card className="w-full max-w-md bg-card border-border">
        <CardContent className="p-8">
          <div className="text-center mb-8">
            <div className="w-16 h-16 rounded-2xl bg-primary/20 flex items-center justify-center mx-auto mb-4">
              <ShieldCheck className="w-8 h-8 text-primary" />
            </div>
            <h1 className="text-2xl font-bold text-foreground">{title}</h1>
            <p className="text-muted-foreground text-sm mt-1">{subtitle}</p>
          </div>
          {body}
          <button type="button" onClick={() => void logout()} className="mt-6 w-full text-sm text-muted-foreground hover:text-foreground">
            Sign out
          </button>
        </CardContent>
      </Card>
    </div>
  );
};
