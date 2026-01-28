import { useState } from "react";
import { motion, AnimatePresence } from "framer-motion";
import { Shield, Upload, Check, Clock, AlertCircle, Camera, FileText, User, CreditCard } from "lucide-react";
import { Sheet, SheetContent, SheetHeader, SheetTitle, SheetDescription } from "@/components/ui/sheet";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Progress } from "@/components/ui/progress";
import { useBankAccounts } from "@/hooks/useBankAccounts";
import { toast } from "sonner";

interface KYCVerificationSheetProps {
  open: boolean;
  onOpenChange: (open: boolean) => void;
}

type KYCStep = "intro" | "personal" | "document" | "selfie" | "review" | "submitted";

interface KYCData {
  fullName: string;
  bvn: string;
  dateOfBirth: string;
  address: string;
  documentType: "nin" | "passport" | "drivers_license" | "";
  documentUploaded: boolean;
  selfieUploaded: boolean;
}

export const KYCVerificationSheet = ({ open, onOpenChange }: KYCVerificationSheetProps) => {
  const { kycStatus, submitKYC } = useBankAccounts();
  const [step, setStep] = useState<KYCStep>("intro");
  const [kycData, setKycData] = useState<KYCData>({
    fullName: "",
    bvn: "",
    dateOfBirth: "",
    address: "",
    documentType: "",
    documentUploaded: false,
    selfieUploaded: false,
  });

  const getProgress = () => {
    switch (step) {
      case "intro": return 0;
      case "personal": return 25;
      case "document": return 50;
      case "selfie": return 75;
      case "review": return 90;
      case "submitted": return 100;
      default: return 0;
    }
  };

  const handleSubmit = () => {
    submitKYC();
    setStep("submitted");
    toast.success("KYC submitted for verification!");
  };

  const simulateUpload = (type: "document" | "selfie") => {
    toast.loading(`Uploading ${type}...`, { id: type });
    setTimeout(() => {
      setKycData((prev) => ({
        ...prev,
        [type === "document" ? "documentUploaded" : "selfieUploaded"]: true,
      }));
      toast.success(`${type === "document" ? "Document" : "Selfie"} uploaded!`, { id: type });
    }, 1500);
  };

  // If already verified or pending
  if (kycStatus === "verified") {
    return (
      <Sheet open={open} onOpenChange={onOpenChange}>
        <SheetContent side="bottom" className="h-[50vh] rounded-t-3xl bg-background">
          <div className="flex flex-col items-center justify-center h-full text-center">
            <motion.div
              initial={{ scale: 0 }}
              animate={{ scale: 1 }}
              className="w-20 h-20 rounded-full bg-green-500/20 flex items-center justify-center mb-4"
            >
              <Check className="w-10 h-10 text-green-500" />
            </motion.div>
            <h2 className="text-2xl font-bold mb-2">KYC Verified! ✓</h2>
            <p className="text-muted-foreground">
              Your identity has been verified. You can now withdraw funds.
            </p>
            <Button className="mt-6" onClick={() => onOpenChange(false)}>
              Continue
            </Button>
          </div>
        </SheetContent>
      </Sheet>
    );
  }

  if (kycStatus === "pending") {
    return (
      <Sheet open={open} onOpenChange={onOpenChange}>
        <SheetContent side="bottom" className="h-[50vh] rounded-t-3xl bg-background">
          <div className="flex flex-col items-center justify-center h-full text-center">
            <motion.div
              animate={{ rotate: 360 }}
              transition={{ duration: 2, repeat: Infinity, ease: "linear" }}
              className="w-20 h-20 rounded-full bg-primary/20 flex items-center justify-center mb-4"
            >
              <Clock className="w-10 h-10 text-primary" />
            </motion.div>
            <h2 className="text-2xl font-bold mb-2">Verification in Progress</h2>
            <p className="text-muted-foreground">
              We're reviewing your documents. This usually takes 24-48 hours.
            </p>
            <Button variant="outline" className="mt-6" onClick={() => onOpenChange(false)}>
              Close
            </Button>
          </div>
        </SheetContent>
      </Sheet>
    );
  }

  return (
    <Sheet open={open} onOpenChange={onOpenChange}>
      <SheetContent side="bottom" className="h-[90vh] rounded-t-3xl bg-background">
        <SheetHeader className="text-left pb-4">
          <SheetTitle className="text-2xl font-bold flex items-center gap-2">
            <Shield className="w-6 h-6 text-primary" />
            Identity Verification
          </SheetTitle>
          <SheetDescription>
            Complete KYC to enable withdrawals
          </SheetDescription>
        </SheetHeader>

        {/* Progress Bar */}
        <div className="mb-6">
          <Progress value={getProgress()} className="h-2" />
          <p className="text-sm text-muted-foreground mt-2">Step {Math.ceil(getProgress() / 25)} of 4</p>
        </div>

        <div className="overflow-y-auto max-h-[60vh] pb-6">
          <AnimatePresence mode="wait">
            {/* Intro Step */}
            {step === "intro" && (
              <motion.div
                key="intro"
                initial={{ opacity: 0, x: 20 }}
                animate={{ opacity: 1, x: 0 }}
                exit={{ opacity: 0, x: -20 }}
                className="space-y-6"
              >
                <div className="text-center py-6">
                  <div className="w-24 h-24 mx-auto rounded-full bg-primary/10 flex items-center justify-center mb-4">
                    <Shield className="w-12 h-12 text-primary" />
                  </div>
                  <h3 className="text-xl font-bold mb-2">Verify Your Identity</h3>
                  <p className="text-muted-foreground">
                    To withdraw funds, we need to verify your identity as required by CBN regulations.
                  </p>
                </div>

                <div className="space-y-3">
                  <div className="flex items-center gap-3 p-3 rounded-xl bg-card border border-border">
                    <User className="w-5 h-5 text-primary" />
                    <div>
                      <p className="font-medium">Personal Information</p>
                      <p className="text-sm text-muted-foreground">Name, BVN, Date of Birth</p>
                    </div>
                  </div>
                  <div className="flex items-center gap-3 p-3 rounded-xl bg-card border border-border">
                    <FileText className="w-5 h-5 text-primary" />
                    <div>
                      <p className="font-medium">Valid ID Document</p>
                      <p className="text-sm text-muted-foreground">NIN, Passport, or Driver's License</p>
                    </div>
                  </div>
                  <div className="flex items-center gap-3 p-3 rounded-xl bg-card border border-border">
                    <Camera className="w-5 h-5 text-primary" />
                    <div>
                      <p className="font-medium">Selfie Verification</p>
                      <p className="text-sm text-muted-foreground">Take a photo holding your ID</p>
                    </div>
                  </div>
                </div>

                <Button className="w-full" size="lg" onClick={() => setStep("personal")}>
                  Start Verification
                </Button>
              </motion.div>
            )}

            {/* Personal Info Step */}
            {step === "personal" && (
              <motion.div
                key="personal"
                initial={{ opacity: 0, x: 20 }}
                animate={{ opacity: 1, x: 0 }}
                exit={{ opacity: 0, x: -20 }}
                className="space-y-4"
              >
                <div className="space-y-2">
                  <Label>Full Legal Name</Label>
                  <Input
                    placeholder="As it appears on your ID"
                    value={kycData.fullName}
                    onChange={(e) => setKycData({ ...kycData, fullName: e.target.value })}
                  />
                </div>

                <div className="space-y-2">
                  <Label>BVN (Bank Verification Number)</Label>
                  <Input
                    type="tel"
                    placeholder="Enter your 11-digit BVN"
                    value={kycData.bvn}
                    onChange={(e) => {
                      const value = e.target.value.replace(/\D/g, "").slice(0, 11);
                      setKycData({ ...kycData, bvn: value });
                    }}
                    maxLength={11}
                  />
                </div>

                <div className="space-y-2">
                  <Label>Date of Birth</Label>
                  <Input
                    type="date"
                    value={kycData.dateOfBirth}
                    onChange={(e) => setKycData({ ...kycData, dateOfBirth: e.target.value })}
                  />
                </div>

                <div className="space-y-2">
                  <Label>Residential Address</Label>
                  <Input
                    placeholder="Your current address"
                    value={kycData.address}
                    onChange={(e) => setKycData({ ...kycData, address: e.target.value })}
                  />
                </div>

                <div className="flex gap-3 pt-4">
                  <Button variant="outline" className="flex-1" onClick={() => setStep("intro")}>
                    Back
                  </Button>
                  <Button
                    className="flex-1"
                    disabled={!kycData.fullName || kycData.bvn.length !== 11 || !kycData.dateOfBirth}
                    onClick={() => setStep("document")}
                  >
                    Continue
                  </Button>
                </div>
              </motion.div>
            )}

            {/* Document Step */}
            {step === "document" && (
              <motion.div
                key="document"
                initial={{ opacity: 0, x: 20 }}
                animate={{ opacity: 1, x: 0 }}
                exit={{ opacity: 0, x: -20 }}
                className="space-y-4"
              >
                <h3 className="font-semibold">Select ID Type</h3>
                <div className="grid grid-cols-3 gap-3">
                  {[
                    { type: "nin", label: "NIN Slip", icon: CreditCard },
                    { type: "passport", label: "Passport", icon: FileText },
                    { type: "drivers_license", label: "Driver's License", icon: CreditCard },
                  ].map(({ type, label, icon: Icon }) => (
                    <button
                      key={type}
                      onClick={() => setKycData({ ...kycData, documentType: type as "nin" | "passport" | "drivers_license" })}
                      className={`p-4 rounded-xl border-2 transition-all ${
                        kycData.documentType === type
                          ? "border-primary bg-primary/10"
                          : "border-border bg-card hover:border-primary/50"
                      }`}
                    >
                      <Icon className="w-8 h-8 mx-auto mb-2" />
                      <p className="text-xs font-medium">{label}</p>
                    </button>
                  ))}
                </div>

                {kycData.documentType && (
                  <motion.div
                    initial={{ opacity: 0, y: 10 }}
                    animate={{ opacity: 1, y: 0 }}
                    className="space-y-4"
                  >
                    <div className="p-6 rounded-2xl border-2 border-dashed border-border bg-card/50 text-center">
                      {kycData.documentUploaded ? (
                        <div className="flex flex-col items-center">
                          <Check className="w-12 h-12 text-green-500 mb-2" />
                          <p className="font-medium text-green-500">Document Uploaded</p>
                        </div>
                      ) : (
                        <>
                          <Upload className="w-12 h-12 mx-auto text-muted-foreground mb-2" />
                          <p className="font-medium mb-1">Upload Document Photo</p>
                          <p className="text-sm text-muted-foreground mb-4">
                            Make sure all details are clearly visible
                          </p>
                          <Button onClick={() => simulateUpload("document")}>
                            <Camera className="w-4 h-4 mr-2" />
                            Take Photo
                          </Button>
                        </>
                      )}
                    </div>
                  </motion.div>
                )}

                <div className="flex gap-3 pt-4">
                  <Button variant="outline" className="flex-1" onClick={() => setStep("personal")}>
                    Back
                  </Button>
                  <Button
                    className="flex-1"
                    disabled={!kycData.documentUploaded}
                    onClick={() => setStep("selfie")}
                  >
                    Continue
                  </Button>
                </div>
              </motion.div>
            )}

            {/* Selfie Step */}
            {step === "selfie" && (
              <motion.div
                key="selfie"
                initial={{ opacity: 0, x: 20 }}
                animate={{ opacity: 1, x: 0 }}
                exit={{ opacity: 0, x: -20 }}
                className="space-y-4"
              >
                <div className="text-center mb-4">
                  <h3 className="font-semibold mb-1">Selfie Verification</h3>
                  <p className="text-sm text-muted-foreground">
                    Take a clear selfie holding your ID next to your face
                  </p>
                </div>

                <div className="p-6 rounded-2xl border-2 border-dashed border-border bg-card/50 text-center">
                  {kycData.selfieUploaded ? (
                    <div className="flex flex-col items-center">
                      <Check className="w-12 h-12 text-green-500 mb-2" />
                      <p className="font-medium text-green-500">Selfie Uploaded</p>
                    </div>
                  ) : (
                    <>
                      <div className="w-24 h-24 mx-auto rounded-full bg-muted flex items-center justify-center mb-4">
                        <Camera className="w-10 h-10 text-muted-foreground" />
                      </div>
                      <p className="font-medium mb-1">Take a Selfie</p>
                      <p className="text-sm text-muted-foreground mb-4">
                        Hold your ID next to your face and look at the camera
                      </p>
                      <Button onClick={() => simulateUpload("selfie")}>
                        <Camera className="w-4 h-4 mr-2" />
                        Take Selfie
                      </Button>
                    </>
                  )}
                </div>

                <div className="p-3 rounded-xl bg-primary/10 text-sm">
                  <p className="flex items-center gap-2">
                    <AlertCircle className="w-4 h-4" />
                    <span>Make sure your face and ID are clearly visible</span>
                  </p>
                </div>

                <div className="flex gap-3 pt-4">
                  <Button variant="outline" className="flex-1" onClick={() => setStep("document")}>
                    Back
                  </Button>
                  <Button
                    className="flex-1"
                    disabled={!kycData.selfieUploaded}
                    onClick={() => setStep("review")}
                  >
                    Review
                  </Button>
                </div>
              </motion.div>
            )}

            {/* Review Step */}
            {step === "review" && (
              <motion.div
                key="review"
                initial={{ opacity: 0, x: 20 }}
                animate={{ opacity: 1, x: 0 }}
                exit={{ opacity: 0, x: -20 }}
                className="space-y-4"
              >
                <h3 className="font-semibold">Review Your Information</h3>

                <div className="space-y-3">
                  <div className="p-4 rounded-xl bg-card border border-border">
                    <p className="text-sm text-muted-foreground mb-1">Full Name</p>
                    <p className="font-medium">{kycData.fullName}</p>
                  </div>
                  <div className="p-4 rounded-xl bg-card border border-border">
                    <p className="text-sm text-muted-foreground mb-1">BVN</p>
                    <p className="font-medium">{kycData.bvn.replace(/(\d{4})(\d{4})(\d{3})/, "$1****$3")}</p>
                  </div>
                  <div className="p-4 rounded-xl bg-card border border-border">
                    <p className="text-sm text-muted-foreground mb-1">Date of Birth</p>
                    <p className="font-medium">{new Date(kycData.dateOfBirth).toLocaleDateString()}</p>
                  </div>
                  <div className="p-4 rounded-xl bg-card border border-border">
                    <p className="text-sm text-muted-foreground mb-1">Document Type</p>
                    <p className="font-medium capitalize">{kycData.documentType.replace("_", " ")}</p>
                  </div>
                  <div className="flex gap-3">
                    <div className="flex-1 p-4 rounded-xl bg-green-500/10 border border-green-500/30 text-center">
                      <Check className="w-6 h-6 text-green-500 mx-auto mb-1" />
                      <p className="text-sm font-medium text-green-500">ID Uploaded</p>
                    </div>
                    <div className="flex-1 p-4 rounded-xl bg-green-500/10 border border-green-500/30 text-center">
                      <Check className="w-6 h-6 text-green-500 mx-auto mb-1" />
                      <p className="text-sm font-medium text-green-500">Selfie Uploaded</p>
                    </div>
                  </div>
                </div>

                <div className="flex gap-3 pt-4">
                  <Button variant="outline" className="flex-1" onClick={() => setStep("selfie")}>
                    Back
                  </Button>
                  <Button className="flex-1" onClick={handleSubmit}>
                    Submit for Verification
                  </Button>
                </div>
              </motion.div>
            )}

            {/* Submitted Step */}
            {step === "submitted" && (
              <motion.div
                key="submitted"
                initial={{ opacity: 0, scale: 0.9 }}
                animate={{ opacity: 1, scale: 1 }}
                className="flex flex-col items-center justify-center py-12 text-center"
              >
                <motion.div
                  initial={{ scale: 0 }}
                  animate={{ scale: 1 }}
                  transition={{ type: "spring", delay: 0.2 }}
                  className="w-24 h-24 rounded-full bg-green-500/20 flex items-center justify-center mb-4"
                >
                  <Check className="w-12 h-12 text-green-500" />
                </motion.div>
                <h3 className="text-2xl font-bold mb-2">Submitted! 🎉</h3>
                <p className="text-muted-foreground mb-6">
                  Your verification is being processed. We'll notify you once it's complete.
                </p>
                <Button onClick={() => onOpenChange(false)}>
                  Done
                </Button>
              </motion.div>
            )}
          </AnimatePresence>
        </div>
      </SheetContent>
    </Sheet>
  );
};
