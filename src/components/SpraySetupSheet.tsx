import { useState } from "react";
import { motion, AnimatePresence } from "framer-motion";
import { X, ArrowLeft, Banknote, Zap, Sparkles, Shield, Loader2 } from "lucide-react";
import { Button } from "@/components/ui/button";
import { toast } from "sonner";
import { PinInput } from "@/components/PinInput";
import { isValidPin } from "@/lib/pin";
import { KYCLevel, KYC_GATES } from "@/types/finance";

interface SpraySetupSheetProps {
  isOpen: boolean;
  onClose: () => void;
  onStartSpray: (amount: number, denomination: number, pin: string) => Promise<void>;
  balance: number;
  eventName: string;
  kycLevel: KYCLevel;
  hasPin: boolean | null;
  isHost?: boolean;
  onOpenKYC?: () => void;
  onPinNotSet?: () => void;
}

type Step = "amount" | "denomination" | "pin";

const QUICK_AMOUNTS = [5000, 10000, 20000, 50000, 100000];
const DENOMINATIONS = [
  { value: 200, label: "₦200", color: "from-green-500 to-emerald-600" },
  { value: 500, label: "₦500", color: "from-blue-500 to-indigo-600" },
  { value: 1000, label: "₦1,000", color: "from-primary to-amber-600" },
];

export const SpraySetupSheet = ({
  isOpen,
  onClose,
  onStartSpray,
  balance,
  eventName,
  kycLevel,
  hasPin,
  isHost = false,
  onOpenKYC,
  onPinNotSet,
}: SpraySetupSheetProps) => {
  const [step, setStep] = useState<Step>("amount");
  const [selectedAmount, setSelectedAmount] = useState<number>(0);
  const [customAmount, setCustomAmount] = useState<string>("");
  const [selectedDenomination, setSelectedDenomination] = useState<number>(0);
  const [pin, setPin] = useState("");
  const [starting, setStarting] = useState(false);

  const handleReset = () => {
    setStep("amount");
    setSelectedAmount(0);
    setSelectedDenomination(0);
    setCustomAmount("");
    setPin("");
    setStarting(false);
    onClose();
  };

  const handleSelectAmount = (amount: number) => {
    if (amount > balance) {
      toast.error("Insufficient balance");
      return;
    }
    setSelectedAmount(amount);
    setStep("denomination");
  };

  const handleCustomAmountProceed = () => {
    const amount = parseInt(customAmount, 10);
    if (!amount || amount < 1000) {
      toast.error("Minimum spray amount is ₦1,000");
      return;
    }
    if (amount > balance) {
      toast.error("Insufficient balance");
      return;
    }
    setSelectedAmount(amount);
    setStep("denomination");
  };

  const handleSelectDenomination = (denomination: number) => {
    if (selectedAmount % denomination !== 0) {
      toast.error(`₦${selectedAmount.toLocaleString()} is not divisible by ₦${denomination} notes`);
      return;
    }
    setSelectedDenomination(denomination);
    setStep("pin");
  };

  const handleConfirmPin = async () => {
    if (!isValidPin(pin)) {
      toast.error("Enter your 4-digit transaction PIN");
      return;
    }
    if (hasPin === false) {
      onPinNotSet?.();
      return;
    }
    setStarting(true);
    try {
      await onStartSpray(selectedAmount, selectedDenomination, pin);
      handleReset();
    } catch {
      /* parent shows toast */
    } finally {
      setStarting(false);
    }
  };

  const handleBack = () => {
    if (step === "pin") setStep("denomination");
    else if (step === "denomination") setStep("amount");
  };

  if (isHost) {
    return (
      <AnimatePresence>
        {isOpen && (
          <>
            <motion.div
              className="fixed inset-0 bg-black/60 backdrop-blur-sm z-50"
              initial={{ opacity: 0 }}
              animate={{ opacity: 1 }}
              exit={{ opacity: 0 }}
              onClick={handleReset}
            />
            <motion.div
              className="fixed bottom-0 left-0 right-0 z-50 flex max-h-[50dvh] flex-col overflow-hidden rounded-t-3xl border-t border-border bg-card p-6 text-center"
              initial={{ y: "100%" }}
              animate={{ y: 0 }}
              exit={{ y: "100%" }}
            >
              <p className="text-lg font-bold mb-2">You’re hosting this event</p>
              <p className="text-sm text-muted-foreground mb-6">
                Hosts receive sprays from guests — you can’t spray your own event.
              </p>
              <Button onClick={handleReset}>Got it</Button>
            </motion.div>
          </>
        )}
      </AnimatePresence>
    );
  }

  if (kycLevel < KYC_GATES.SPRAY) {
    return (
      <AnimatePresence>
        {isOpen && (
          <>
            <motion.div
              className="fixed inset-0 bg-black/60 backdrop-blur-sm z-50"
              initial={{ opacity: 0 }}
              animate={{ opacity: 1 }}
              exit={{ opacity: 0 }}
              onClick={handleReset}
            />
            <motion.div
              className="fixed bottom-0 left-0 right-0 z-50 flex max-h-[50dvh] flex-col overflow-hidden rounded-t-3xl border-t border-border bg-card p-6 text-center"
              initial={{ y: "100%" }}
              animate={{ y: 0 }}
              exit={{ y: "100%" }}
            >
              <div className="w-16 h-16 rounded-full bg-primary/10 flex items-center justify-center mx-auto mb-4">
                <Shield className="w-8 h-8 text-primary" />
              </div>
              <p className="text-lg font-bold mb-2">Complete verification to spray</p>
              <p className="text-sm text-muted-foreground mb-6">
                BVN + NIN verification (Level 2) is required before you can spray at events.
              </p>
              <Button
                onClick={() => {
                  handleReset();
                  onOpenKYC?.();
                }}
              >
                Complete verification
              </Button>
            </motion.div>
          </>
        )}
      </AnimatePresence>
    );
  }

  return (
    <AnimatePresence>
      {isOpen && (
        <>
          <motion.div
            className="fixed inset-0 bg-black/60 backdrop-blur-sm z-50"
            initial={{ opacity: 0 }}
            animate={{ opacity: 1 }}
            exit={{ opacity: 0 }}
            onClick={handleReset}
          />

          <motion.div
            className="fixed bottom-0 left-0 right-0 z-50 flex max-h-[85dvh] flex-col overflow-hidden rounded-t-3xl border-t border-border bg-card"
            initial={{ y: "100%" }}
            animate={{ y: 0 }}
            exit={{ y: "100%" }}
            transition={{ type: "spring", damping: 25, stiffness: 300 }}
          >
            <div className="flex shrink-0 justify-center pt-3 pb-2">
              <div className="h-1.5 w-12 rounded-full bg-muted" />
            </div>

            <div className="flex shrink-0 items-center justify-between border-b border-border px-6 pb-4">
              <div className="flex items-center gap-3">
                {step !== "amount" && (
                  <button
                    onClick={handleBack}
                    className="p-2 hover:bg-muted rounded-full transition-colors"
                  >
                    <ArrowLeft className="w-5 h-5 text-muted-foreground" />
                  </button>
                )}
                <div>
                  <h2 className="text-xl font-bold text-foreground">
                    {step === "amount" && "Let's Spray! 💸"}
                    {step === "denomination" && "Choose Notes"}
                    {step === "pin" && "Confirm with PIN"}
                  </h2>
                  <p className="text-sm text-muted-foreground">{eventName}</p>
                </div>
              </div>
              <button
                onClick={handleReset}
                className="p-2 hover:bg-muted rounded-full transition-colors"
              >
                <X className="w-5 h-5 text-muted-foreground" />
              </button>
            </div>

            <div className="min-h-0 flex-1 overflow-y-auto overscroll-y-contain p-6 [-webkit-overflow-scrolling:touch]">
              <AnimatePresence mode="sync">
                {step === "amount" && (
                  <motion.div
                    key="amount"
                    initial={{ opacity: 0, x: -20 }}
                    animate={{ opacity: 1, x: 0 }}
                    exit={{ opacity: 0, x: 20 }}
                    className="space-y-6"
                  >
                    <div className="glass rounded-2xl p-4 flex items-center justify-between">
                      <div>
                        <p className="text-sm text-muted-foreground">Available Balance</p>
                        <p className="text-2xl font-bold text-primary">₦{balance.toLocaleString()}</p>
                      </div>
                      <div className="text-4xl">💰</div>
                    </div>

                    <div>
                      <p className="text-sm text-muted-foreground mb-4">Quick amounts</p>
                      <div className="grid grid-cols-3 gap-3">
                        {QUICK_AMOUNTS.map((amount) => (
                          <motion.button
                            key={amount}
                            className={`p-4 rounded-2xl text-center transition-colors ${
                              amount > balance
                                ? "bg-muted/50 text-muted-foreground cursor-not-allowed"
                                : "glass hover:bg-primary/20"
                            }`}
                            whileHover={amount <= balance ? { scale: 1.05 } : {}}
                            whileTap={amount <= balance ? { scale: 0.95 } : {}}
                            onClick={() => handleSelectAmount(amount)}
                            disabled={amount > balance}
                          >
                            <p className="text-lg font-bold text-foreground">
                              ₦{amount.toLocaleString()}
                            </p>
                            <p className="text-xs text-muted-foreground">
                              {Math.floor(amount / 200)} notes @ ₦200
                            </p>
                          </motion.button>
                        ))}
                      </div>
                    </div>

                    <div>
                      <p className="text-sm text-muted-foreground mb-3">Or enter custom amount</p>
                      <div className="flex gap-3">
                        <div className="relative flex-1">
                          <span className="absolute left-4 top-1/2 -translate-y-1/2 text-xl font-bold text-muted-foreground">
                            ₦
                          </span>
                          <input
                            type="number"
                            value={customAmount}
                            onChange={(e) => setCustomAmount(e.target.value)}
                            placeholder="5,000"
                            className="w-full h-14 pl-10 pr-4 bg-muted border-none rounded-xl text-xl font-bold text-foreground placeholder:text-muted-foreground focus:outline-none focus:ring-2 focus:ring-primary"
                          />
                        </div>
                        <Button
                          variant="gold"
                          size="lg"
                          onClick={handleCustomAmountProceed}
                          disabled={!customAmount || parseInt(customAmount, 10) < 1000}
                          className="h-14"
                        >
                          <Zap className="w-5 h-5" />
                        </Button>
                      </div>
                    </div>
                  </motion.div>
                )}

                {step === "denomination" && (
                  <motion.div
                    key="denomination"
                    initial={{ opacity: 0, x: -20 }}
                    animate={{ opacity: 1, x: 0 }}
                    exit={{ opacity: 0, x: 20 }}
                    className="space-y-6"
                  >
                    <div className="glass rounded-2xl p-4 text-center">
                      <p className="text-sm text-muted-foreground">You're spraying</p>
                      <p className="text-3xl font-black text-gradient-gold">
                        ₦{selectedAmount.toLocaleString()}
                      </p>
                    </div>

                    <div>
                      <p className="text-sm text-muted-foreground mb-4">Choose denomination</p>
                      <div className="space-y-3">
                        {DENOMINATIONS.map((denom) => {
                          const noteCount = Math.floor(selectedAmount / denom.value);
                          const divisible = selectedAmount % denom.value === 0;
                          const duration = Math.ceil(noteCount);

                          return (
                            <motion.button
                              key={denom.value}
                              className={`w-full p-4 glass rounded-2xl flex items-center gap-4 transition-colors ${
                                divisible ? "hover:bg-card-elevated" : "opacity-50 cursor-not-allowed"
                              }`}
                              whileHover={divisible ? { scale: 1.02, x: 4 } : {}}
                              whileTap={divisible ? { scale: 0.98 } : {}}
                              onClick={() => handleSelectDenomination(denom.value)}
                              disabled={!divisible}
                            >
                              <div className={`w-14 h-14 rounded-2xl bg-gradient-to-br ${denom.color} flex items-center justify-center`}>
                                <Banknote className="w-7 h-7 text-white" />
                              </div>
                              <div className="flex-1 text-left">
                                <h3 className="font-bold text-foreground text-lg">{denom.label} Notes</h3>
                                <p className="text-sm text-muted-foreground">
                                  {divisible
                                    ? `${noteCount} notes • ${duration}s spray`
                                    : `Doesn't divide evenly — pick another amount`}
                                </p>
                              </div>
                              {divisible && <Sparkles className="w-5 h-5 text-primary" />}
                            </motion.button>
                          );
                        })}
                      </div>
                    </div>

                    <div className="glass rounded-xl p-3 border-l-4 border-primary">
                      <p className="text-xs text-muted-foreground">
                        💡 Amount must divide evenly by your note choice (e.g. ₦5,000 works with ₦200, ₦500, or ₦1,000).
                      </p>
                    </div>
                  </motion.div>
                )}

                {step === "pin" && (
                  <motion.div
                    key="pin"
                    initial={{ opacity: 0, x: -20 }}
                    animate={{ opacity: 1, x: 0 }}
                    exit={{ opacity: 0, x: 20 }}
                    className="space-y-6"
                  >
                    <div className="glass rounded-2xl p-4 text-center">
                      <p className="text-sm text-muted-foreground">Confirm spray of</p>
                      <p className="text-3xl font-black text-gradient-gold">
                        ₦{selectedAmount.toLocaleString()}
                      </p>
                      <p className="text-sm text-muted-foreground mt-1">
                        {Math.floor(selectedAmount / selectedDenomination)} × ₦{selectedDenomination} notes
                      </p>
                    </div>
                    <PinInput value={pin} onChange={setPin} label="Transaction PIN" />
                    <Button
                      variant="gold"
                      size="lg"
                      className="w-full h-14"
                      onClick={() => void handleConfirmPin()}
                      disabled={!isValidPin(pin) || starting}
                    >
                      {starting ? (
                        <>
                          <Loader2 className="w-5 h-5 mr-2 animate-spin" />
                          Verifying…
                        </>
                      ) : (
                        "Start spraying"
                      )}
                    </Button>
                  </motion.div>
                )}
              </AnimatePresence>
            </div>
          </motion.div>
        </>
      )}
    </AnimatePresence>
  );
};
