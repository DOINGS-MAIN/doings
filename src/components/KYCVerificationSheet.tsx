import { useState } from "react";
import { motion, AnimatePresence } from "framer-motion";
import {
  Shield,
  Check,
  Mail,
  CreditCard,
  ChevronRight,
  Lock,
  Fingerprint,
} from "lucide-react";
import { Sheet, SheetContent, SheetHeader, SheetTitle, SheetDescription } from "@/components/ui/sheet";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Progress } from "@/components/ui/progress";
import { toast } from "sonner";
import { KYCLevel } from "@/types/finance";

interface KYCVerificationSheetProps {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  currentLevel: KYCLevel;
  onVerifyLevel1: (action: "resend" | "check") => Promise<{ success: boolean; message: string }>;
  onVerifyLevel2: (bvn: string, nin: string, dateOfBirth: string) => Promise<{ success: boolean; message: string }>;
}

type Step = "overview" | "level1" | "level2" | "processing" | "success";

export const KYCVerificationSheet = ({
  open,
  onOpenChange,
  currentLevel,
  onVerifyLevel1,
  onVerifyLevel2,
}: KYCVerificationSheetProps) => {
  const [step, setStep] = useState<Step>("overview");
  const [isProcessing, setIsProcessing] = useState(false);

  const [bvn, setBvn] = useState("");
  const [nin, setNin] = useState("");
  const [dateOfBirth, setDateOfBirth] = useState("");

  const handleResendEmail = async () => {
    setIsProcessing(true);
    try {
      const r = await onVerifyLevel1("resend");
      if (r.success) toast.success(r.message);
      else toast.error(r.message);
    } finally {
      setIsProcessing(false);
    }
  };

  const handleCheckEmail = async () => {
    setIsProcessing(true);
    setStep("processing");
    try {
      const r = await onVerifyLevel1("check");
      if (r.success) {
        setStep("success");
        toast.success(r.message);
      } else {
        toast.error(r.message);
        setStep("level1");
      }
    } catch {
      toast.error("Could not refresh verification status");
      setStep("level1");
    } finally {
      setIsProcessing(false);
    }
  };

  const handleVerifyLevel2 = async () => {
    setIsProcessing(true);
    setStep("processing");
    try {
      const result = await onVerifyLevel2(bvn, nin, dateOfBirth);
      if (result.success) {
        setStep("success");
        toast.success(result.message);
      } else {
        toast.error(result.message);
        setStep("level2");
      }
    } catch {
      toast.error("Verification failed");
      setStep("level2");
    } finally {
      setIsProcessing(false);
    }
  };

  const resetAndClose = () => {
    setStep("overview");
    setIsProcessing(false);
    setBvn("");
    setNin("");
    setDateOfBirth("");
    onOpenChange(false);
  };

  const maxLevel = 2;
  const levels = [
    {
      level: 1 as KYCLevel,
      title: "Email verification",
      subtitle: "Confirm your email address",
      icon: Mail,
      benefits: ["Receive in-app transfers", "Redeem giveaways"],
      color: "text-secondary",
      bgColor: "bg-secondary/20",
    },
    {
      level: 2 as KYCLevel,
      title: "BVN + NIN",
      subtitle: "Dojah identity check & bank transfer account",
      icon: Fingerprint,
      benefits: ["Fund NGN (transfer account)", "USDC deposit address", "Send, spray, withdraw"],
      color: "text-primary",
      bgColor: "bg-primary/20",
    },
  ];

  return (
    <Sheet open={open} onOpenChange={onOpenChange}>
      <SheetContent
        side="bottom"
        className="flex h-[90dvh] max-h-[90dvh] flex-col overflow-hidden rounded-t-3xl bg-background"
      >
        <SheetHeader className="shrink-0 text-left pb-4">
          <SheetTitle className="flex items-center gap-2 text-2xl font-bold">
            <Shield className="h-6 w-6 text-primary" />
            Identity Verification
          </SheetTitle>
          <SheetDescription>
            {currentLevel >= 2
              ? "Fully verified — all features unlocked"
              : `Level ${currentLevel}/${maxLevel} — Complete verification to unlock features`}
          </SheetDescription>
        </SheetHeader>

        <div className="mb-6 shrink-0">
          <Progress value={(currentLevel / maxLevel) * 100} className="h-2" />
          <div className="flex justify-between mt-2">
            {[1, 2].map((l) => (
              <span
                key={l}
                className={`text-xs font-medium ${
                  l <= currentLevel ? "text-primary" : "text-muted-foreground"
                }`}
              >
                Level {l} {l <= currentLevel && "✓"}
              </span>
            ))}
          </div>
        </div>

        <div className="min-h-0 flex-1 overflow-y-auto overscroll-y-contain pb-6 [-webkit-overflow-scrolling:touch]">
          <AnimatePresence mode="sync">
            {step === "overview" && (
              <motion.div
                key="overview"
                initial={{ opacity: 0, x: 20 }}
                animate={{ opacity: 1, x: 0 }}
                exit={{ opacity: 0, x: -20 }}
                className="space-y-4"
              >
                {levels.map((lvl) => {
                  const completed = currentLevel >= lvl.level;
                  const isNext = currentLevel === lvl.level - 1;
                  const locked = currentLevel < lvl.level - 1;

                  return (
                    <motion.button
                      key={lvl.level}
                      type="button"
                      onClick={() => {
                        if (completed) return;
                        if (locked) {
                          toast.info(`Complete Level ${lvl.level - 1} first`);
                          return;
                        }
                        setStep(`level${lvl.level}` as Step);
                      }}
                      className={`w-full p-4 rounded-2xl border-2 text-left transition-all ${
                        completed
                          ? "border-success/50 bg-success/5"
                          : isNext
                          ? "border-primary/50 bg-primary/5 hover:border-primary"
                          : "border-border bg-card opacity-60"
                      }`}
                      whileHover={isNext ? { scale: 1.01 } : {}}
                      whileTap={isNext ? { scale: 0.99 } : {}}
                    >
                      <div className="flex items-center gap-3 mb-3">
                        <div className={`w-12 h-12 rounded-xl ${lvl.bgColor} flex items-center justify-center`}>
                          {completed ? (
                            <Check className="w-6 h-6 text-success" />
                          ) : locked ? (
                            <Lock className="w-6 h-6 text-muted-foreground" />
                          ) : (
                            <lvl.icon className={`w-6 h-6 ${lvl.color}`} />
                          )}
                        </div>
                        <div className="flex-1">
                          <div className="flex items-center gap-2">
                            <h3 className="font-bold text-foreground">{lvl.title}</h3>
                            {completed && (
                              <span className="text-xs bg-success/20 text-success px-2 py-0.5 rounded-full">
                                Verified
                              </span>
                            )}
                          </div>
                          <p className="text-sm text-muted-foreground">{lvl.subtitle}</p>
                        </div>
                        {isNext && <ChevronRight className="w-5 h-5 text-primary" />}
                      </div>
                      <div className="space-y-1 ml-15">
                        {lvl.benefits.map((b) => (
                          <p key={b} className="text-xs text-muted-foreground flex items-center gap-1">
                            <span className={completed ? "text-success" : "text-muted-foreground"}>
                              {completed ? "✓" : "•"}
                            </span>
                            {b}
                          </p>
                        ))}
                      </div>
                    </motion.button>
                  );
                })}

                {currentLevel >= 2 && (
                  <div className="text-center py-4">
                    <p className="text-success font-bold text-lg">Fully verified</p>
                    <p className="text-muted-foreground text-sm">All features are unlocked</p>
                  </div>
                )}
              </motion.div>
            )}

            {step === "level1" && (
              <motion.div
                key="level1"
                initial={{ opacity: 0, x: 20 }}
                animate={{ opacity: 1, x: 0 }}
                exit={{ opacity: 0, x: -20 }}
                className="space-y-4"
              >
                <div className="text-center mb-4">
                  <div className="w-16 h-16 mx-auto rounded-full bg-secondary/20 flex items-center justify-center mb-3">
                    <Mail className="w-8 h-8 text-secondary" />
                  </div>
                  <h3 className="font-bold text-lg">Verify your email</h3>
                  <p className="text-sm text-muted-foreground">
                    Open the link in the email we sent when you signed up. You can resend the message if needed.
                  </p>
                </div>

                <Button className="w-full" variant="secondary" onClick={() => void handleResendEmail()} disabled={isProcessing}>
                  Resend confirmation email
                </Button>
                <Button className="w-full" onClick={() => void handleCheckEmail()} disabled={isProcessing}>
                  I&apos;ve confirmed my email
                </Button>

                <Button variant="ghost" className="w-full" onClick={() => setStep("overview")}>
                  Back
                </Button>
              </motion.div>
            )}

            {step === "level2" && (
              <motion.div
                key="level2"
                initial={{ opacity: 0, x: 20 }}
                animate={{ opacity: 1, x: 0 }}
                exit={{ opacity: 0, x: -20 }}
                className="space-y-4"
              >
                <div className="text-center mb-4">
                  <div className="w-16 h-16 mx-auto rounded-full bg-primary/20 flex items-center justify-center mb-3">
                    <CreditCard className="w-8 h-8 text-primary" />
                  </div>
                  <h3 className="font-bold text-lg">BVN &amp; NIN</h3>
                  <p className="text-sm text-muted-foreground">
                    We verify both with Dojah, then create your Monnify transfer account in the same step.
                  </p>
                </div>

                <div className="space-y-2">
                  <Label>BVN (11 digits)</Label>
                  <Input
                    type="text"
                    inputMode="numeric"
                    placeholder="Bank Verification Number"
                    value={bvn}
                    onChange={(e) => setBvn(e.target.value.replace(/\D/g, "").slice(0, 11))}
                    maxLength={11}
                  />
                </div>

                <div className="space-y-2">
                  <Label>NIN (11 digits)</Label>
                  <Input
                    type="text"
                    inputMode="numeric"
                    placeholder="National Identification Number"
                    value={nin}
                    onChange={(e) => setNin(e.target.value.replace(/\D/g, "").slice(0, 11))}
                    maxLength={11}
                  />
                </div>

                <div className="space-y-2">
                  <Label>Date of birth (optional)</Label>
                  <Input type="date" value={dateOfBirth} onChange={(e) => setDateOfBirth(e.target.value)} />
                </div>

                <Button
                  className="w-full"
                  onClick={() => void handleVerifyLevel2()}
                  disabled={bvn.length !== 11 || nin.length !== 11 || isProcessing}
                >
                  Verify &amp; create transfer account
                </Button>

                <Button variant="ghost" className="w-full" onClick={() => setStep("overview")}>
                  Back
                </Button>
              </motion.div>
            )}

            {step === "processing" && (
              <motion.div
                key="processing"
                initial={{ opacity: 0 }}
                animate={{ opacity: 1 }}
                className="flex flex-col items-center justify-center py-16"
              >
                <motion.div
                  animate={{ rotate: 360 }}
                  transition={{ duration: 1, repeat: Infinity, ease: "linear" }}
                  className="w-16 h-16 border-4 border-primary border-t-transparent rounded-full mb-6"
                />
                <p className="text-xl font-bold">Working…</p>
                <p className="text-muted-foreground text-sm">This may take a few seconds</p>
              </motion.div>
            )}

            {step === "success" && (
              <motion.div
                key="success"
                initial={{ opacity: 0, scale: 0.9 }}
                animate={{ opacity: 1, scale: 1 }}
                className="flex flex-col items-center justify-center py-12 text-center"
              >
                <motion.div
                  initial={{ scale: 0 }}
                  animate={{ scale: 1 }}
                  transition={{ type: "spring", delay: 0.2 }}
                  className="w-24 h-24 rounded-full bg-success/20 flex items-center justify-center mb-4"
                >
                  <Check className="w-12 h-12 text-success" />
                </motion.div>
                <h3 className="text-2xl font-bold mb-2">Step complete</h3>
                <p className="text-muted-foreground mb-4">
                  {currentLevel >= 2 ? "You have full access." : "Continue when you’re ready."}
                </p>
                <Button onClick={resetAndClose}>Continue</Button>
              </motion.div>
            )}
          </AnimatePresence>
        </div>
      </SheetContent>
    </Sheet>
  );
};
