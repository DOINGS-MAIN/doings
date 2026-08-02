import { useEffect } from "react";
import { Navigate, useSearchParams } from "react-router-dom";
import { motion } from "framer-motion";
import { Loader2 } from "lucide-react";
import { toast } from "sonner";
import { Link } from "react-router-dom";
import { ArrowLeft } from "lucide-react";
import { AuthFlow } from "@/components/AuthFlow";
import { useAuth } from "@/hooks/useAuth";

export default function LoginPage() {
  const [searchParams, setSearchParams] = useSearchParams();
  const {
    initialized,
    loading,
    isAuthenticated,
    signInWithPassword,
    signUpWithPassword,
    resetPasswordForEmail,
    resendSignupEmail,
    signInWithGoogle,
    updateProfile,
    setUsername,
  } = useAuth();

  useEffect(() => {
    const reset = searchParams.get("reset");
    const auth = searchParams.get("auth");
    if (reset === "success") {
      toast.success("Password updated. Log in with your new password.");
      const next = new URLSearchParams(searchParams);
      next.delete("reset");
      setSearchParams(next, { replace: true });
      return;
    }
    if (auth === "email_link_invalid") {
      toast.error("That confirmation link is invalid or expired. Try signing up again or resend the email.");
      const next = new URLSearchParams(searchParams);
      next.delete("auth");
      setSearchParams(next, { replace: true });
      return;
    }
    if (auth === "reset_link_invalid") {
      toast.error("That password reset link is invalid or expired. Request a new one from Forgot password.");
      const next = new URLSearchParams(searchParams);
      next.delete("auth");
      setSearchParams(next, { replace: true });
    }
  }, [searchParams, setSearchParams]);

  if (!initialized || loading) {
    return (
      <div className="min-h-dvh flex items-center justify-center">
        <Loader2 className="w-8 h-8 animate-spin text-primary" />
      </div>
    );
  }

  if (isAuthenticated) {
    const join = searchParams.get("join");
    const redeem = searchParams.get("redeem");
    if (join) {
      return <Navigate to={`/events?join=${encodeURIComponent(join.toUpperCase())}`} replace />;
    }
    if (redeem) {
      return <Navigate to={`/gifts?redeem=${encodeURIComponent(redeem.toUpperCase())}`} replace />;
    }
    return <Navigate to="/home" replace />;
  }

  return (
    <div className="min-h-dvh relative overflow-x-hidden">
      <motion.div
        initial={{ opacity: 0 }}
        animate={{ opacity: 1 }}
        transition={{ duration: 0.4 }}
        className="relative z-10 pb-32"
      >
        <motion.div
          className="flex flex-col items-center pt-8 pb-6 px-6"
          initial={{ opacity: 0, y: -20 }}
          animate={{ opacity: 1, y: 0 }}
          transition={{ duration: 0.6 }}
        >
          <Link
            to="/"
            className="self-start flex items-center gap-2 text-sm text-muted-foreground hover:text-foreground mb-8 transition-colors"
          >
            <ArrowLeft className="w-4 h-4" />
            Back
          </Link>
          <h1 className="text-2xl font-black text-gradient-gold tracking-tight mb-2">DOINGS</h1>
          <p className="text-muted-foreground text-center text-sm max-w-xs">
            Sign in or create an account to join events and spray live.
          </p>
        </motion.div>

        <AuthFlow
          onComplete={() => {}}
          signInWithPassword={signInWithPassword}
          signUpWithPassword={signUpWithPassword}
          resetPasswordForEmail={resetPasswordForEmail}
          resendSignupEmail={resendSignupEmail}
          signInWithGoogle={signInWithGoogle}
          updateProfile={updateProfile}
          saveUsername={setUsername}
        />
      </motion.div>
    </div>
  );
}
