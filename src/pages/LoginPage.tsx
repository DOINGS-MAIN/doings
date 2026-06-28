import { useEffect } from "react";
import { Navigate, useSearchParams } from "react-router-dom";
import { motion } from "framer-motion";
import { Loader2 } from "lucide-react";
import { toast } from "sonner";
import { HeroSection } from "@/components/HeroSection";
import { FeatureCards } from "@/components/FeatureCards";
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
          className="flex items-center justify-center pt-12 pb-4"
          initial={{ opacity: 0, y: -20 }}
          animate={{ opacity: 1, y: 0 }}
          transition={{ duration: 0.6 }}
        >
          <h1 className="text-2xl font-black text-gradient-gold tracking-tight">DOINGS</h1>
        </motion.div>

        <HeroSection />
        <FeatureCards />
        <AuthFlow
          onComplete={() => {}}
          signInWithPassword={signInWithPassword}
          signUpWithPassword={signUpWithPassword}
          resetPasswordForEmail={resetPasswordForEmail}
          resendSignupEmail={resendSignupEmail}
          signInWithGoogle={signInWithGoogle}
          updateProfile={updateProfile}
        />
      </motion.div>
    </div>
  );
}
