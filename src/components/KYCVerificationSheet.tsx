import { useState } from "react";
import { motion, AnimatePresence } from "framer-motion";
import {
  Shield,
  Check,
  Clock,
  AlertCircle,
  Camera,
  Phone,
  Mail,
  CreditCard,
  Fingerprint,
  ChevronRight,
  Lock,
} from "lucide-react";
import { Sheet, SheetContent, SheetHeader, SheetTitle, SheetDescription } from "@/components/ui/sheet";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Progress } from "@/components/ui/progress";
import { toast } from "sonner";
import { KYCLevel, KYC_GATES } from "@/types/finance";

interface KYCVerificationSheetProps {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  currentLevel: KYCLevel;
  onVerifyLevel1: (phone: string, email: string, fullName: string) => Promise<boolean>;
  onVerifyLevel2: (bvn: string, dateOfBirth: string) => Promise<{ success: boolean; message: string }>;
  onVerifyLevel3: (nin: string, selfieBase64: string) => Promise<{ success: boolean; message: string; confidence?: number }>;
}

type Step = "overview" | "level1" | "level2" | "level3" | "processing" | "success";

export const KYCVerificationSheet = ({
  open,
  onOpenChange,
  currentLevel,
  onVerifyLevel1,
  onVerifyLevel2,
  onVerifyLevel3,
}: KYCVerificationSheetProps) => {
  const [step, setStep] = useState<Step>("overview");
  const [isProcessing, setIsProcessing] = useState(false);

  // Level 1 fields
  const [phone, setPhone] = useState("");
  const [email, setEmail] = useState("");
  const [fullName, setFullName] = useState("");
  const [otp, setOtp] = useState("");
  const [otpSent, setOtpSent] = useState(false);

  // Level 2 fields
  const [bvn, setBvn] = useState("");
  const [dateOfBirth, setDateOfBirth] = useState("");

  // Level 3 fields
  const [nin, setNin] = useState("");
  const [selfieUploaded, setSelfieUploaded] = useState(false);
  const [confidence, setConfidence] = useState<number | null>(null);

  const handleSendOtp = () => {
    if (!phone || phone.length < 10) {
      toast.error("Enter a valid phone number");
      return;
    }
    setOtpSent(true);
    toast.success("OTP sent to your phone!");
  };

  const handleVerifyLevel1 = async () => {
    if (otp.length !== 6) {
      toast.error("Enter the 6-digit OTP");
      return;
    }
    setIsProcessing(true);
    setStep("processing");
    try {
      await onVerifyLevel1(phone, email, fullName);
      setStep("success");
      toast.success("Level 1 verified! 🎉");
    } catch {
      toast.error("Verification failed");
      setStep("level1");
    } finally {
      setIsProcessing(false);
    }
  };

  const handleVerifyLevel2 = async () => {
    setIsProcessing(true);
    setStep("processing");
    try {
      const result = await onVerifyLevel2(bvn, dateOfBirth);
      if (result.success) {
        setStep("success");
        toast.success("BVN verified! Level 2 unlocked 🎉");
      } else {
        toast.error(result.message);
        setStep("level2");
      }
    } catch {
      toast.error("BVN verification failed");
      setStep("level2");
    } finally {
      setIsProcessing(false);
    }
  };

  const handleVerifyLevel3 = async () => {
    setIsProcessing(true);
    setStep("processing");
    try {
      const result = await onVerifyLevel3(nin, "mock-base64-selfie");
      if (result.success) {
        setConfidence(result.confidence || 0);
        setStep("success");
        toast.success(`Identity verified! Confidence: ${result.confidence}% 🎉`);
      } else {
        toast.error(result.message);
        setStep("level3");
      }
    } catch {
      toast.error("Identity verification failed");
      setStep("level3");
    } finally {
      setIsProcessing(false);
    }
  };

  const simulateSelfie = () => {
    toast.loading("Capturing selfie...", { id: "selfie" });
    setTimeout(() => {
      setSelfieUploaded(true);
      toast.success("Selfie captured!", { id: "selfie" });
    }, 1500);
  };

  const resetAndClose = () => {
    setStep("overview");
    setOtp("");
    setOtpSent(false);
    setIsProcessing(false);
    setConfidence(null);
    setSelfieUploaded(false);
    onOpenChange(false);
  };

  const levels = [
    {
      level: 1 as KYCLevel,
      title: "Basic Verification",
      subtitle: "Phone & Email OTP",
      icon: Phone,
      benefits: ["Receive in-app transfers", "View wallet & transactions"],
      color: "text-secondary",
      bgColor: "bg-secondary/20",
    },
    {
      level: 2 as KYCLevel,
      title: "BVN Verification",
      subtitle: "Dojah Identity Check",
      icon: CreditCard,
      benefits: ["Fund NGN wallet (Monnify)", "Receive USDT", "Send money in-app"],
      color: "text-primary",
      bgColor: "bg-primary/20",
    },
    {
      level: 3 as KYCLevel,
      title: "Full Identity Verification",
      subtitle: "NIN + Selfie Match",
      icon: Fingerprint,
      benefits: ["Withdraw NGN to bank", "Withdraw USDT externally", "Unlimited transactions"],
      color: "text-accent",
      bgColor: "bg-accent/20",
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
            {currentLevel === 3
              ? "Fully verified — all features unlocked"
              : `Level ${currentLevel}/3 — Complete verification to unlock features`}
          </SheetDescription>
        </SheetHeader>

        {/* Progress */}
        <div className="mb-6 shrink-0">
          <Progress value={(currentLevel / 3) * 100} className="h-2" />
          <div className="flex justify-between mt-2">
            {[1, 2, 3].map((l) => (
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
            {/* Overview */}
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

                {currentLevel === 3 && (
                  <div className="text-center py-4">
                    <p className="text-success font-bold text-lg">🎉 Fully Verified!</p>
                    <p className="text-muted-foreground text-sm">All features are unlocked</p>
                  </div>
                )}
              </motion.div>
            )}

            {/* Level 1: Phone + Email */}
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
                    <Phone className="w-8 h-8 text-secondary" />
                  </div>
                  <h3 className="font-bold text-lg">Basic Verification</h3>
                  <p className="text-sm text-muted-foreground">Verify your phone number and email</p>
                </div>

                <div className="space-y-2">
                  <Label>Full Name</Label>
                  <Input
                    placeholder="Your full name"
                    value={fullName}
                    onChange={(e) => setFullName(e.target.value)}
                  />
                </div>

                <div className="space-y-2">
                  <Label>Phone Number</Label>
                  <Input
                    type="tel"
                    placeholder="+234 800 000 0000"
                    value={phone}
                    onChange={(e) => setPhone(e.target.value)}
                  />
                </div>

                <div className="space-y-2">
                  <Label>Email Address</Label>
                  <Input
                    type="email"
                    placeholder="you@example.com"
                    value={email}
                    onChange={(e) => setEmail(e.target.value)}
                  />
                </div>

                {!otpSent ? (
                  <Button
                    className="w-full"
                    onClick={handleSendOtp}
                    disabled={!phone || !email || !fullName}
                  >
                    <Mail className="w-4 h-4 mr-2" />
                    Send OTP
                  </Button>
                ) : (
                  <>
                    <div className="space-y-2">
                      <Label>Enter OTP</Label>
                      <Input
                        type="text"
                        inputMode="numeric"
                        placeholder="000000"
                        value={otp}
                        onChange={(e) => setOtp(e.target.value.replace(/\D/g, "").slice(0, 6))}
                        maxLength={6}
                        className="text-center text-2xl tracking-[0.5em] font-bold"
                      />
                      <p className="text-xs text-muted-foreground text-center">
                        Demo: enter any 6 digits
                      </p>
                    </div>
                    <Button className="w-full" onClick={handleVerifyLevel1} disabled={otp.length !== 6}>
                      Verify
                    </Button>
                  </>
                )}

                <Button variant="ghost" className="w-full" onClick={() => setStep("overview")}>
                  Back
                </Button>
              </motion.div>
            )}

            {/* Level 2: BVN */}
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
                  <h3 className="font-bold text-lg">BVN Verification</h3>
                  <p className="text-sm text-muted-foreground">
                    We'll validate your BVN with Dojah to unlock funding
                  </p>
                </div>

                <div className="p-3 rounded-xl bg-primary/10 border border-primary/20">
                  <p className="text-xs text-muted-foreground flex items-center gap-2">
                    <AlertCircle className="w-4 h-4 text-primary" />
                    Your BVN is only used for identity verification and is never stored
                  </p>
                </div>

                <div className="space-y-2">
                  <Label>BVN (Bank Verification Number)</Label>
                  <Input
                    type="text"
                    inputMode="numeric"
                    placeholder="Enter your 11-digit BVN"
                    value={bvn}
                    onChange={(e) => setBvn(e.target.value.replace(/\D/g, "").slice(0, 11))}
                    maxLength={11}
                  />
                </div>

                <div className="space-y-2">
                  <Label>Date of Birth</Label>
                  <Input
                    type="date"
                    value={dateOfBirth}
                    onChange={(e) => setDateOfBirth(e.target.value)}
                  />
                </div>

                <Button
                  className="w-full"
                  onClick={handleVerifyLevel2}
                  disabled={bvn.length !== 11 || !dateOfBirth}
                >
                  Verify BVN
                </Button>

                <Button variant="ghost" className="w-full" onClick={() => setStep("overview")}>
                  Back
                </Button>
              </motion.div>
            )}

            {/* Level 3: NIN + Selfie */}
            {step === "level3" && (
              <motion.div
                key="level3"
                initial={{ opacity: 0, x: 20 }}
                animate={{ opacity: 1, x: 0 }}
                exit={{ opacity: 0, x: -20 }}
                className="space-y-4"
              >
                <div className="text-center mb-4">
                  <div className="w-16 h-16 mx-auto rounded-full bg-accent/20 flex items-center justify-center mb-3">
                    <Fingerprint className="w-8 h-8 text-accent" />
                  </div>
                  <h3 className="font-bold text-lg">Full Identity Verification</h3>
                  <p className="text-sm text-muted-foreground">
                    NIN + selfie biometric match via Dojah
                  </p>
                </div>

                <div className="space-y-2">
                  <Label>NIN (National Identification Number)</Label>
                  <Input
                    type="text"
                    inputMode="numeric"
                    placeholder="Enter your 11-digit NIN"
                    value={nin}
                    onChange={(e) => setNin(e.target.value.replace(/\D/g, "").slice(0, 11))}
                    maxLength={11}
                  />
                </div>

                <div className="p-6 rounded-2xl border-2 border-dashed border-border bg-card/50 text-center">
                  {selfieUploaded ? (
                    <div className="flex flex-col items-center">
                      <Check className="w-12 h-12 text-success mb-2" />
                      <p className="font-medium text-success">Selfie Captured</p>
                    </div>
                  ) : (
                    <>
                      <div className="w-20 h-20 mx-auto rounded-full bg-muted flex items-center justify-center mb-3">
                        <Camera className="w-10 h-10 text-muted-foreground" />
                      </div>
                      <p className="font-medium mb-1">Take a Selfie</p>
                      <p className="text-sm text-muted-foreground mb-4">
                        Look directly at the camera
                      </p>
                      <Button onClick={simulateSelfie}>
                        <Camera className="w-4 h-4 mr-2" />
                        Capture Selfie
                      </Button>
                    </>
                  )}
                </div>

                <Button
                  className="w-full"
                  onClick={handleVerifyLevel3}
                  disabled={nin.length !== 11 || !selfieUploaded}
                >
                  Verify Identity
                </Button>

                <Button variant="ghost" className="w-full" onClick={() => setStep("overview")}>
                  Back
                </Button>
              </motion.div>
            )}

            {/* Processing */}
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
                <p className="text-xl font-bold">Verifying with Dojah...</p>
                <p className="text-muted-foreground text-sm">This may take a few seconds</p>
              </motion.div>
            )}

            {/* Success */}
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
                <h3 className="text-2xl font-bold mb-2">Verification Complete! 🎉</h3>
                <p className="text-muted-foreground mb-2">
                  You're now at Level {currentLevel}
                </p>
                {confidence && (
                  <p className="text-sm text-success mb-4">
                    Biometric confidence: {confidence}%
                  </p>
                )}
                <Button onClick={resetAndClose}>Continue</Button>
              </motion.div>
            )}
          </AnimatePresence>
        </div>
      </SheetContent>
    </Sheet>
  );
};
