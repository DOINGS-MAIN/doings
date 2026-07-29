import { useState, useRef } from "react";
import { motion, AnimatePresence } from "framer-motion";
import gsap from "gsap";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { PasswordInput } from "@/components/PasswordInput";
import { Label } from "@/components/ui/label";
import { toast } from "sonner";
import { ArrowRight, Mail, Loader2 } from "lucide-react";
import type { User } from "@supabase/supabase-js";
import type { SignUpResult } from "@/types/auth";
import { normalizeUsernameInput, USERNAME_RE, usernameRpcError } from "@/lib/username";
import { profileApi } from "@/lib/supabase";

const EMAIL_RE = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;
const MIN_PASSWORD = 8;

function metaFullName(user: User | null): string {
  if (!user?.user_metadata) return "";
  const m = user.user_metadata as Record<string, unknown>;
  const fn = typeof m.first_name === "string" ? m.first_name.trim() : "";
  const ln = typeof m.last_name === "string" ? m.last_name.trim() : "";
  if (fn || ln) return `${fn} ${ln}`.trim();
  const name = m.full_name ?? m.name;
  return typeof name === "string" ? name.trim() : "";
}

interface AuthFlowProps {
  onComplete?: () => void;
  signInWithPassword: (email: string, password: string) => Promise<User | null>;
  signUpWithPassword: (
    email: string,
    password: string,
    firstName: string,
    lastName: string,
    username: string
  ) => Promise<SignUpResult>;
  resetPasswordForEmail: (email: string) => Promise<void>;
  resendSignupEmail: (email: string) => Promise<void>;
  signInWithGoogle: () => Promise<unknown>;
  updateProfile?: (updates: { full_name?: string }) => Promise<void>;
  saveUsername?: (username: string) => Promise<void>;
}

export const AuthFlow = ({
  onComplete,
  signInWithPassword,
  signUpWithPassword,
  resetPasswordForEmail,
  resendSignupEmail,
  signInWithGoogle,
  updateProfile,
  saveUsername,
}: AuthFlowProps) => {
  const [mode, setMode] = useState<"login" | "signup">("login");
  const [step, setStep] = useState<"form" | "name" | "success" | "verify-email" | "forgot" | "forgot-sent">("form");
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [confirmPassword, setConfirmPassword] = useState("");
  const [firstName, setFirstName] = useState("");
  const [lastName, setLastName] = useState("");
  const [username, setUsername] = useState("");
  const [fullName, setFullName] = useState("");
  const [loading, setLoading] = useState(false);
  const [resendLoading, setResendLoading] = useState(false);
  const [error, setError] = useState("");
  const containerRef = useRef<HTMLDivElement>(null);

  const resetFormFields = () => {
    setPassword("");
    setConfirmPassword("");
    setFirstName("");
    setLastName("");
    setUsername("");
    setError("");
  };

  const switchMode = (next: "login" | "signup") => {
    setMode(next);
    setStep("form");
    resetFormFields();
  };

  const finishAuth = () => {
    setStep("success");
    if (containerRef.current) {
      gsap.to(containerRef.current, {
        scale: 1.02,
        duration: 0.2,
        yoyo: true,
        repeat: 1,
      });
    }
    setTimeout(() => {
      onComplete?.();
    }, 2000);
  };

  const handlePasswordAuth = async (e: React.FormEvent) => {
    e.preventDefault();
    const trimmedEmail = email.trim().toLowerCase();
    if (!EMAIL_RE.test(trimmedEmail) || password.length < MIN_PASSWORD) return;

    if (mode === "signup") {
      if (password !== confirmPassword) {
        setError("Passwords do not match");
        return;
      }
      if (!firstName.trim() || !lastName.trim()) {
        setError("Enter your first and last name");
        return;
      }
      const u = normalizeUsernameInput(username);
      if (!USERNAME_RE.test(u)) {
        setError("Username: 3–30 characters, letters, numbers, or underscore only");
        return;
      }
      const { data: available, error: availErr } = await profileApi.isUsernameAvailable(u);
      if (availErr) {
        setError(usernameRpcError(availErr));
        return;
      }
      if (!available) {
        setError("This username is already taken");
        return;
      }
    }

    setLoading(true);
    setError("");
    try {
      if (mode === "login") {
        const user = await signInWithPassword(trimmedEmail, password);
        if (metaFullName(user)) {
          finishAuth();
        } else {
          setStep("name");
        }
      } else {
        const u = normalizeUsernameInput(username);
        const result = await signUpWithPassword(
          trimmedEmail,
          password,
          firstName.trim(),
          lastName.trim(),
          u
        );
        if (result.needsEmailConfirmation) {
          setStep("verify-email");
          return;
        }
        const user = result.user;
        if (user && metaFullName(user)) {
          finishAuth();
        } else if (user) {
          setStep("name");
        } else {
          setError("Could not create account. Try again.");
        }
      }
    } catch (err: unknown) {
      setError(usernameRpcError(err, err instanceof Error ? err.message : "Something went wrong"));
    } finally {
      setLoading(false);
    }
  };

  const handleGoogle = async () => {
    setLoading(true);
    setError("");
    try {
      await signInWithGoogle();
    } catch (err: unknown) {
      setError(err instanceof Error ? err.message : "Google sign-in failed");
      setLoading(false);
    }
  };

  const handleForgotSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    const trimmedEmail = email.trim().toLowerCase();
    if (!EMAIL_RE.test(trimmedEmail)) return;
    setLoading(true);
    setError("");
    try {
      await resetPasswordForEmail(trimmedEmail);
      setStep("forgot-sent");
    } catch (err: unknown) {
      setError(err instanceof Error ? err.message : "Could not send reset email");
    } finally {
      setLoading(false);
    }
  };

  const handleResendSignup = async () => {
    const trimmedEmail = email.trim().toLowerCase();
    if (!EMAIL_RE.test(trimmedEmail)) return;
    setResendLoading(true);
    setError("");
    try {
      await resendSignupEmail(trimmedEmail);
      // Supabase returns OK even when no mail is sent (already confirmed / unknown email).
      toast.success(
        "If this address still needs confirmation, we sent a new link. Check inbox and spam."
      );
    } catch (err: unknown) {
      setError(err instanceof Error ? err.message : "Could not resend email");
    } finally {
      setResendLoading(false);
    }
  };

  const handleNameSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!fullName.trim()) return;

    const u = normalizeUsernameInput(username);
    if (!USERNAME_RE.test(u)) {
      setError("Username: 3–30 characters, letters, numbers, or underscore only");
      return;
    }

    setLoading(true);
    setError("");
    try {
      const { data: available, error: availErr } = await profileApi.isUsernameAvailable(u);
      if (availErr) {
        setError(usernameRpcError(availErr));
        return;
      }
      if (!available) {
        setError("This username is already taken");
        return;
      }

      await updateProfile?.({ full_name: fullName.trim() });
      await saveUsername?.(u);
      finishAuth();
    } catch (err: unknown) {
      setError(usernameRpcError(err, err instanceof Error ? err.message : "Failed to save profile"));
    } finally {
      setLoading(false);
    }
  };

  const slideVariants = {
    enter: { x: 50, opacity: 0 },
    center: { x: 0, opacity: 1 },
    exit: { x: -50, opacity: 0 },
  };

  const emailValid = EMAIL_RE.test(email.trim());
  const passwordOk = password.length >= MIN_PASSWORD;
  const canSubmitLogin = emailValid && passwordOk;
  const normalizedUser = normalizeUsernameInput(username);
  const canSubmitSignup =
    emailValid &&
    passwordOk &&
    confirmPassword === password &&
    firstName.trim().length >= 1 &&
    lastName.trim().length >= 1 &&
    USERNAME_RE.test(normalizedUser);

  return (
    <motion.div
      ref={containerRef}
      className="glass-strong rounded-3xl p-8 mx-6 mb-8"
      initial={{ opacity: 0, y: 30 }}
      animate={{ opacity: 1, y: 0 }}
      transition={{ duration: 0.6, delay: 0.7 }}
    >
      <AnimatePresence mode="sync">
        {step === "form" && (
          <motion.div
            key="form"
            variants={slideVariants}
            initial="enter"
            animate="center"
            exit="exit"
            transition={{ duration: 0.3 }}
          >
            <div className="flex items-center gap-3 mb-5">
              <div className="bg-primary/20 p-3 rounded-2xl">
                <Mail className="w-6 h-6 text-primary" />
              </div>
              <div>
                <h2 className="font-bold text-xl text-foreground">Get Started</h2>
                <p className="text-sm text-muted-foreground">
                  {mode === "login" ? "Log in to your account" : "Create an account"}
                </p>
              </div>
            </div>

            <div className="flex rounded-xl bg-muted/50 p-1 mb-6">
              <button
                type="button"
                onClick={() => switchMode("login")}
                className={`flex-1 py-2.5 text-sm font-semibold rounded-lg transition-colors ${
                  mode === "login"
                    ? "bg-background text-foreground shadow-sm"
                    : "text-muted-foreground hover:text-foreground"
                }`}
              >
                Log in
              </button>
              <button
                type="button"
                onClick={() => switchMode("signup")}
                className={`flex-1 py-2.5 text-sm font-semibold rounded-lg transition-colors ${
                  mode === "signup"
                    ? "bg-background text-foreground shadow-sm"
                    : "text-muted-foreground hover:text-foreground"
                }`}
              >
                Sign up
              </button>
            </div>

            <form onSubmit={handlePasswordAuth} className="space-y-4">
              <div className="space-y-2">
                <Label htmlFor="auth-email">Email</Label>
                <Input
                  id="auth-email"
                  type="email"
                  placeholder="you@example.com"
                  value={email}
                  onChange={(e) => setEmail(e.target.value)}
                  autoComplete="email"
                  className="text-base"
                />
              </div>

              {mode === "signup" ? (
                <>
                  <div className="grid grid-cols-2 gap-3">
                    <div className="space-y-2">
                      <Label htmlFor="auth-first">First name</Label>
                      <Input
                        id="auth-first"
                        type="text"
                        placeholder="Ade"
                        value={firstName}
                        onChange={(e) => setFirstName(e.target.value)}
                        autoComplete="given-name"
                        className="text-base"
                      />
                    </div>
                    <div className="space-y-2">
                      <Label htmlFor="auth-last">Last name</Label>
                      <Input
                        id="auth-last"
                        type="text"
                        placeholder="Johnson"
                        value={lastName}
                        onChange={(e) => setLastName(e.target.value)}
                        autoComplete="family-name"
                        className="text-base"
                      />
                    </div>
                  </div>
                  <div className="space-y-2">
                    <Label htmlFor="auth-username">Username</Label>
                    <div className="relative">
                      <span className="absolute left-3 top-1/2 -translate-y-1/2 text-muted-foreground font-medium pointer-events-none select-none">
                        @
                      </span>
                      <Input
                        id="auth-username"
                        type="text"
                        placeholder="your_handle"
                        value={username}
                        onChange={(e) => setUsername(normalizeUsernameInput(e.target.value))}
                        autoComplete="username"
                        className="text-base pl-8"
                      />
                    </div>
                    <p className="text-[11px] text-muted-foreground">
                      3–30 characters: lowercase letters, numbers, underscore
                    </p>
                  </div>
                </>
              ) : null}

              <div className="space-y-2">
                <Label htmlFor="auth-password">Password</Label>
                <PasswordInput
                  id="auth-password"
                  placeholder={mode === "login" ? "Your password" : `At least ${MIN_PASSWORD} characters`}
                  value={password}
                  onChange={(e) => setPassword(e.target.value)}
                  autoComplete={mode === "login" ? "current-password" : "new-password"}
                  className="text-base"
                />
                {mode === "login" ? (
                  <div className="flex justify-end">
                    <button
                      type="button"
                      className="text-xs font-medium text-primary hover:underline"
                      onClick={() => {
                        setError("");
                        setStep("forgot");
                      }}
                    >
                      Forgot password?
                    </button>
                  </div>
                ) : null}
              </div>

              {mode === "signup" ? (
                <div className="space-y-2">
                  <Label htmlFor="auth-confirm">Confirm password</Label>
                  <PasswordInput
                    id="auth-confirm"
                    placeholder="Repeat password"
                    value={confirmPassword}
                    onChange={(e) => setConfirmPassword(e.target.value)}
                    autoComplete="new-password"
                    className="text-base"
                  />
                </div>
              ) : null}

              <Button
                type="submit"
                variant="hero"
                size="lg"
                className="w-full"
                disabled={loading || (mode === "login" ? !canSubmitLogin : !canSubmitSignup)}
              >
                {loading ? (
                  <Loader2 className="w-5 h-5 animate-spin" />
                ) : (
                  <>
                    {mode === "login" ? "Log in" : "Create account"}
                    <ArrowRight className="w-5 h-5" />
                  </>
                )}
              </Button>
            </form>

            <div className="relative my-6">
              <div className="absolute inset-0 flex items-center">
                <span className="w-full border-t border-border" />
              </div>
              <div className="relative flex justify-center text-xs uppercase">
                <span className="bg-card px-2 text-muted-foreground">Or</span>
              </div>
            </div>

            <Button
              type="button"
              variant="outline"
              size="lg"
              className="w-full font-semibold"
              disabled={loading}
              onClick={handleGoogle}
            >
              <svg className="mr-2 h-5 w-5" viewBox="0 0 24 24" aria-hidden>
                <path
                  fill="currentColor"
                  d="M22.56 12.25c0-.78-.07-1.53-.2-2.25H12v4.26h5.92c-.26 1.37-1.04 2.53-2.21 3.31v2.77h3.57c2.08-1.92 3.28-4.74 3.28-8.09z"
                />
                <path
                  fill="currentColor"
                  d="M12 23c2.97 0 5.46-.98 7.28-2.66l-3.57-2.77c-.98.66-2.23 1.06-3.71 1.06-2.86 0-5.29-1.93-6.16-4.53H2.18v2.84C3.99 20.53 7.7 23 12 23z"
                />
                <path
                  fill="currentColor"
                  d="M5.84 14.09c-.22-.66-.35-1.36-.35-2.09s.13-1.43.35-2.09V7.07H2.18C1.43 8.55 1 10.22 1 12s.43 3.45 1.18 4.93l2.85-2.22.81-.62z"
                />
                <path
                  fill="currentColor"
                  d="M12 5.38c1.62 0 3.06.56 4.21 1.64l3.15-3.15C17.45 2.09 14.97 1 12 1 7.7 1 3.99 3.47 2.18 7.07l3.66 2.84c.87-2.6 3.3-4.53 6.16-4.53z"
                />
              </svg>
              Continue with Google
            </Button>

            {error ? <p className="text-xs text-destructive text-center mt-3">{error}</p> : null}
          </motion.div>
        )}

        {step === "forgot" && (
          <motion.div
            key="forgot"
            variants={slideVariants}
            initial="enter"
            animate="center"
            exit="exit"
            transition={{ duration: 0.3 }}
          >
            <div className="mb-5 flex items-center gap-3">
              <div className="rounded-2xl bg-primary/20 p-3">
                <Mail className="h-6 w-6 text-primary" />
              </div>
              <div>
                <h2 className="text-xl font-bold text-foreground">Reset password</h2>
                <p className="text-sm text-muted-foreground">We&apos;ll email you a secure link</p>
              </div>
            </div>
            <form onSubmit={(e) => void handleForgotSubmit(e)} className="space-y-4">
              <div className="space-y-2">
                <Label htmlFor="forgot-email">Email</Label>
                <Input
                  id="forgot-email"
                  type="email"
                  autoComplete="email"
                  value={email}
                  onChange={(e) => setEmail(e.target.value)}
                  placeholder="you@example.com"
                  className="text-base"
                />
              </div>
              <Button type="submit" variant="hero" size="lg" className="w-full" disabled={loading || !EMAIL_RE.test(email.trim())}>
                {loading ? <Loader2 className="h-5 w-5 animate-spin" /> : "Send reset link"}
              </Button>
              <Button
                type="button"
                variant="ghost"
                className="w-full"
                onClick={() => {
                  setError("");
                  setStep("form");
                }}
              >
                Back to log in
              </Button>
            </form>
            {error ? <p className="mt-3 text-center text-xs text-destructive">{error}</p> : null}
          </motion.div>
        )}

        {step === "forgot-sent" && (
          <motion.div
            key="forgot-sent"
            variants={slideVariants}
            initial="enter"
            animate="center"
            exit="exit"
            transition={{ duration: 0.3 }}
            className="space-y-4 py-2 text-center"
          >
            <div className="text-4xl">✉️</div>
            <h2 className="text-xl font-bold text-foreground">Check your email</h2>
            <p className="text-sm text-muted-foreground">
              If an account exists for <span className="font-medium text-foreground">{email.trim()}</span>, you will
              receive a link to choose a new password. The link expires after a while.
            </p>
            <Button type="button" variant="hero" className="w-full" size="lg" onClick={() => switchMode("login")}>
              Back to log in
            </Button>
          </motion.div>
        )}

        {step === "verify-email" && (
          <motion.div
            key="verify-email"
            variants={slideVariants}
            initial="enter"
            animate="center"
            exit="exit"
            transition={{ duration: 0.3 }}
            className="space-y-4 py-2 text-center"
          >
            <div className="text-4xl">✉️</div>
            <h2 className="text-xl font-bold text-foreground">Confirm your email</h2>
            <p className="text-sm text-muted-foreground">
              We sent a confirmation link to <span className="font-medium text-foreground">{email.trim()}</span>.
              Open it to activate your account, then log in here.
            </p>
            <Button
              type="button"
              variant="outline"
              className="w-full"
              disabled={resendLoading || !EMAIL_RE.test(email.trim())}
              onClick={() => void handleResendSignup()}
            >
              {resendLoading ? <Loader2 className="h-5 w-5 animate-spin" /> : "Resend confirmation email"}
            </Button>
            <Button type="button" variant="ghost" className="w-full" onClick={() => switchMode("login")}>
              Back to log in
            </Button>
            {error ? <p className="text-xs text-destructive">{error}</p> : null}
          </motion.div>
        )}

        {step === "name" && (
          <motion.div
            key="name"
            variants={slideVariants}
            initial="enter"
            animate="center"
            exit="exit"
            transition={{ duration: 0.3 }}
          >
            <div className="flex items-center gap-3 mb-6">
              <div className="bg-accent/20 p-3 rounded-2xl">
                <span className="text-2xl">👤</span>
              </div>
              <div>
                <h2 className="font-bold text-xl text-foreground">Complete your profile</h2>
                <p className="text-sm text-muted-foreground">Name and username for sprays &amp; send money</p>
              </div>
            </div>

            <form onSubmit={handleNameSubmit} className="space-y-4">
              <Input
                type="text"
                placeholder="Full name"
                value={fullName}
                onChange={(e) => setFullName(e.target.value)}
                className="text-lg"
                autoFocus
              />

              <div className="space-y-2">
                <Label htmlFor="oauth-username">Username</Label>
                <div className="relative">
                  <span className="absolute left-3 top-1/2 -translate-y-1/2 text-muted-foreground font-medium pointer-events-none select-none">
                    @
                  </span>
                  <Input
                    id="oauth-username"
                    type="text"
                    placeholder="your_handle"
                    value={username}
                    onChange={(e) => setUsername(normalizeUsernameInput(e.target.value))}
                    autoComplete="username"
                    className="text-base pl-8"
                  />
                </div>
                <p className="text-[11px] text-muted-foreground">
                  3–30 characters: lowercase letters, numbers, underscore
                </p>
              </div>

              <Button
                type="submit"
                variant="hero"
                size="lg"
                className="w-full"
                disabled={!fullName.trim() || !USERNAME_RE.test(normalizeUsernameInput(username)) || loading}
              >
                {loading ? (
                  <Loader2 className="w-5 h-5 animate-spin" />
                ) : (
                  <>
                    Continue
                    <ArrowRight className="w-5 h-5" />
                  </>
                )}
              </Button>
            </form>

            {error ? <p className="text-xs text-destructive text-center mt-3">{error}</p> : null}
          </motion.div>
        )}

        {step === "success" && (
          <motion.div
            key="success"
            variants={slideVariants}
            initial="enter"
            animate="center"
            exit="exit"
            transition={{ duration: 0.3 }}
            className="text-center py-4"
          >
            <motion.div
              className="text-6xl mb-4"
              initial={{ scale: 0 }}
              animate={{ scale: 1 }}
              transition={{ type: "spring", stiffness: 200, damping: 10 }}
            >
              🎉
            </motion.div>
            <h2 className="font-bold text-2xl text-foreground mb-2">Welcome to Doings!</h2>
            <p className="text-muted-foreground">Setting up your account...</p>
          </motion.div>
        )}
      </AnimatePresence>
    </motion.div>
  );
};
