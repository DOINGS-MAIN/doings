import { useState, useRef, useEffect } from "react";
import { motion, AnimatePresence } from "framer-motion";
import gsap from "gsap";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { ArrowRight, Smartphone, ShieldCheck, Loader2 } from "lucide-react";

interface AuthFlowProps {
  onComplete?: () => void;
  sendOtp: (phone: string) => Promise<void>;
  verifyOtp: (phone: string, token: string) => Promise<unknown>;
  updateProfile?: (updates: { full_name?: string }) => Promise<void>;
  existingName?: string | null;
}

export const AuthFlow = ({ onComplete, sendOtp, verifyOtp, updateProfile, existingName }: AuthFlowProps) => {
  const [step, setStep] = useState<"phone" | "otp" | "name" | "success">("phone");
  const [phone, setPhone] = useState("");
  const [fullName, setFullName] = useState("");
  const [otp, setOtp] = useState(["", "", "", "", "", ""]);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState("");
  const containerRef = useRef<HTMLDivElement>(null);
  const otpRefs = useRef<(HTMLInputElement | null)[]>([]);

  useEffect(() => {
    if (step === "otp" && otpRefs.current[0]) {
      otpRefs.current[0]?.focus();
    }
  }, [step]);

  const handlePhoneSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    if (phone.length < 10) return;
    
    setLoading(true);
    setError("");
    try {
      await sendOtp(phone);
      setStep("otp");
    } catch (err: unknown) {
      setError(err instanceof Error ? err.message : "Failed to send OTP");
    } finally {
      setLoading(false);
    }
  };

  const handleOtpChange = (index: number, value: string) => {
    if (value.length > 1) return;
    
    const newOtp = [...otp];
    newOtp[index] = value;
    setOtp(newOtp);

    // Auto-focus next input
    if (value && index < 5) {
      otpRefs.current[index + 1]?.focus();
    }

    // Auto-submit when complete
    if (newOtp.every((digit) => digit) && newOtp.join("").length === 6) {
      handleOtpSubmit(newOtp.join(""));
    }
  };

  const handleOtpKeyDown = (index: number, e: React.KeyboardEvent) => {
    if (e.key === "Backspace" && !otp[index] && index > 0) {
      otpRefs.current[index - 1]?.focus();
    }
  };

  const handleOtpSubmit = async (code: string) => {
    setLoading(true);
    setError("");
    try {
      await verifyOtp(phone, code);
      if (existingName) {
        finishAuth();
      } else {
        setStep("name");
      }
    } catch (err: unknown) {
      setError(err instanceof Error ? err.message : "Invalid OTP");
      setOtp(["", "", "", "", "", ""]);
      otpRefs.current[0]?.focus();
    } finally {
      setLoading(false);
    }
  };

  const handleNameSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!fullName.trim()) return;
    setLoading(true);
    setError("");
    try {
      await updateProfile?.({ full_name: fullName.trim() });
      finishAuth();
    } catch (err: unknown) {
      setError(err instanceof Error ? err.message : "Failed to save name");
    } finally {
      setLoading(false);
    }
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

  const slideVariants = {
    enter: { x: 50, opacity: 0 },
    center: { x: 0, opacity: 1 },
    exit: { x: -50, opacity: 0 },
  };

  return (
    <motion.div
      ref={containerRef}
      className="glass-strong rounded-3xl p-8 mx-6 mb-8"
      initial={{ opacity: 0, y: 30 }}
      animate={{ opacity: 1, y: 0 }}
      transition={{ duration: 0.6, delay: 0.7 }}
    >
      <AnimatePresence mode="sync">
        {step === "phone" && (
          <motion.div
            key="phone"
            variants={slideVariants}
            initial="enter"
            animate="center"
            exit="exit"
            transition={{ duration: 0.3 }}
          >
            <div className="flex items-center gap-3 mb-6">
              <div className="bg-primary/20 p-3 rounded-2xl">
                <Smartphone className="w-6 h-6 text-primary" />
              </div>
              <div>
                <h2 className="font-bold text-xl text-foreground">Get Started</h2>
                <p className="text-sm text-muted-foreground">Enter your phone number</p>
              </div>
            </div>

            <form onSubmit={handlePhoneSubmit} className="space-y-4">
              <div className="relative">
                <span className="absolute left-4 top-1/2 -translate-y-1/2 text-muted-foreground font-medium">
                  +234
                </span>
                <Input
                  type="tel"
                  placeholder="8012345678"
                  value={phone}
                  onChange={(e) => setPhone(e.target.value.replace(/\D/g, "").slice(0, 10))}
                  className="pl-16 text-lg tracking-wide"
                  autoFocus
                />
              </div>

              <Button
                type="submit"
                variant="hero"
                size="lg"
                className="w-full"
                disabled={phone.length < 10 || loading}
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

            {error && (
              <p className="text-xs text-destructive text-center mt-3">{error}</p>
            )}
            <p className="text-xs text-muted-foreground text-center mt-4">
              We'll send you a verification code via SMS
            </p>
          </motion.div>
        )}

        {step === "otp" && (
          <motion.div
            key="otp"
            variants={slideVariants}
            initial="enter"
            animate="center"
            exit="exit"
            transition={{ duration: 0.3 }}
          >
            <div className="flex items-center gap-3 mb-6">
              <div className="bg-secondary/20 p-3 rounded-2xl">
                <ShieldCheck className="w-6 h-6 text-secondary" />
              </div>
              <div>
                <h2 className="font-bold text-xl text-foreground">Verify Code</h2>
                <p className="text-sm text-muted-foreground">Sent to +234 {phone}</p>
              </div>
            </div>

            <div className="flex gap-3 justify-center mb-6">
              {otp.map((digit, index) => (
                <motion.input
                  key={index}
                  ref={(el) => (otpRefs.current[index] = el)}
                  type="text"
                  inputMode="numeric"
                  maxLength={1}
                  value={digit}
                  onChange={(e) => handleOtpChange(index, e.target.value)}
                  onKeyDown={(e) => handleOtpKeyDown(index, e)}
                  className="w-12 h-14 rounded-xl bg-input border-2 border-border text-center text-xl font-bold text-foreground focus:border-primary focus:outline-none focus:ring-2 focus:ring-primary/20 transition-all"
                  initial={{ scale: 0.8, opacity: 0 }}
                  animate={{ scale: 1, opacity: 1 }}
                  transition={{ delay: index * 0.05 }}
                />
              ))}
            </div>

            {loading && (
              <div className="flex items-center justify-center gap-2 text-muted-foreground">
                <Loader2 className="w-5 h-5 animate-spin" />
                <span>Verifying...</span>
              </div>
            )}

            {error && (
              <p className="text-xs text-destructive text-center mt-3">{error}</p>
            )}

            <button
              onClick={() => setStep("phone")}
              className="text-sm text-primary hover:underline w-full text-center mt-4"
            >
              Change phone number
            </button>
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
                <h2 className="font-bold text-xl text-foreground">What's your name?</h2>
                <p className="text-sm text-muted-foreground">So people know who's spraying</p>
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

              <Button
                type="submit"
                variant="hero"
                size="lg"
                className="w-full"
                disabled={!fullName.trim() || loading}
              >
                {loading ? (
                  <Loader2 className="w-5 h-5 animate-spin" />
                ) : (
                  <>
                    Let's Go!
                    <ArrowRight className="w-5 h-5" />
                  </>
                )}
              </Button>
            </form>

            {error && (
              <p className="text-xs text-destructive text-center mt-3">{error}</p>
            )}
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
