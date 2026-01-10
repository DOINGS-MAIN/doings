import { useState } from "react";
import { motion, AnimatePresence } from "framer-motion";
import { X, ArrowLeft, Banknote, Zap, Sparkles } from "lucide-react";
import { Button } from "@/components/ui/button";
import { toast } from "sonner";

interface SpraySetupSheetProps {
  isOpen: boolean;
  onClose: () => void;
  onStartSpray: (amount: number, denomination: number) => void;
  balance: number;
  eventName: string;
}

type Step = "amount" | "denomination";

const QUICK_AMOUNTS = [5000, 10000, 20000, 50000, 100000];
const DENOMINATIONS = [
  { value: 200, label: "₦200", color: "from-green-500 to-emerald-600", count: "25 notes for ₦5,000" },
  { value: 500, label: "₦500", color: "from-blue-500 to-indigo-600", count: "10 notes for ₦5,000" },
  { value: 1000, label: "₦1,000", color: "from-primary to-amber-600", count: "5 notes for ₦5,000" },
];

export const SpraySetupSheet = ({ 
  isOpen, 
  onClose, 
  onStartSpray, 
  balance,
  eventName 
}: SpraySetupSheetProps) => {
  const [step, setStep] = useState<Step>("amount");
  const [selectedAmount, setSelectedAmount] = useState<number>(0);
  const [customAmount, setCustomAmount] = useState<string>("");

  const handleSelectAmount = (amount: number) => {
    if (amount > balance) {
      toast.error("Insufficient balance");
      return;
    }
    setSelectedAmount(amount);
    setStep("denomination");
  };

  const handleCustomAmountProceed = () => {
    const amount = parseInt(customAmount);
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
    onStartSpray(selectedAmount, denomination);
    handleReset();
  };

  const handleReset = () => {
    setStep("amount");
    setSelectedAmount(0);
    setCustomAmount("");
    onClose();
  };

  const handleBack = () => {
    if (step === "denomination") setStep("amount");
  };

  const noteCount = selectedAmount > 0 ? Math.floor(selectedAmount / 200) : 0;
  const sprayDuration = Math.ceil(noteCount);

  return (
    <AnimatePresence>
      {isOpen && (
        <>
          {/* Backdrop */}
          <motion.div
            className="fixed inset-0 bg-black/60 backdrop-blur-sm z-50"
            initial={{ opacity: 0 }}
            animate={{ opacity: 1 }}
            exit={{ opacity: 0 }}
            onClick={handleReset}
          />

          {/* Sheet */}
          <motion.div
            className="fixed bottom-0 left-0 right-0 z-50 bg-card border-t border-border rounded-t-3xl max-h-[85vh] overflow-hidden"
            initial={{ y: "100%" }}
            animate={{ y: 0 }}
            exit={{ y: "100%" }}
            transition={{ type: "spring", damping: 25, stiffness: 300 }}
          >
            {/* Handle */}
            <div className="flex justify-center pt-3 pb-2">
              <div className="w-12 h-1.5 bg-muted rounded-full" />
            </div>

            {/* Header */}
            <div className="flex items-center justify-between px-6 pb-4 border-b border-border">
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

            {/* Content */}
            <div className="p-6 overflow-y-auto max-h-[60vh]">
              <AnimatePresence mode="wait">
                {/* Step 1: Select Amount */}
                {step === "amount" && (
                  <motion.div
                    key="amount"
                    initial={{ opacity: 0, x: -20 }}
                    animate={{ opacity: 1, x: 0 }}
                    exit={{ opacity: 0, x: 20 }}
                    className="space-y-6"
                  >
                    {/* Balance display */}
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
                              {Math.floor(amount / 200)} notes
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
                          disabled={!customAmount || parseInt(customAmount) < 1000}
                          className="h-14"
                        >
                          <Zap className="w-5 h-5" />
                        </Button>
                      </div>
                    </div>
                  </motion.div>
                )}

                {/* Step 2: Select Denomination */}
                {step === "denomination" && (
                  <motion.div
                    key="denomination"
                    initial={{ opacity: 0, x: -20 }}
                    animate={{ opacity: 1, x: 0 }}
                    exit={{ opacity: 0, x: 20 }}
                    className="space-y-6"
                  >
                    {/* Amount summary */}
                    <div className="glass rounded-2xl p-4 text-center">
                      <p className="text-sm text-muted-foreground">You're spraying</p>
                      <p className="text-3xl font-black text-gradient-gold">
                        ₦{selectedAmount.toLocaleString()}
                      </p>
                      <p className="text-sm text-muted-foreground mt-1">
                        ~{sprayDuration} seconds of spray time
                      </p>
                    </div>

                    <div>
                      <p className="text-sm text-muted-foreground mb-4">Choose denomination</p>
                      <div className="space-y-3">
                        {DENOMINATIONS.map((denom) => {
                          const noteCount = Math.floor(selectedAmount / denom.value);
                          const duration = Math.ceil(noteCount);
                          
                          return (
                            <motion.button
                              key={denom.value}
                              className="w-full p-4 glass rounded-2xl flex items-center gap-4 hover:bg-card-elevated transition-colors"
                              whileHover={{ scale: 1.02, x: 4 }}
                              whileTap={{ scale: 0.98 }}
                              onClick={() => handleSelectDenomination(denom.value)}
                            >
                              <div className={`w-14 h-14 rounded-2xl bg-gradient-to-br ${denom.color} flex items-center justify-center`}>
                                <Banknote className="w-7 h-7 text-white" />
                              </div>
                              <div className="flex-1 text-left">
                                <h3 className="font-bold text-foreground text-lg">{denom.label} Notes</h3>
                                <p className="text-sm text-muted-foreground">
                                  {noteCount} notes • {duration}s spray
                                </p>
                              </div>
                              <Sparkles className="w-5 h-5 text-primary" />
                            </motion.button>
                          );
                        })}
                      </div>
                    </div>

                    <div className="glass rounded-xl p-3 border-l-4 border-primary">
                      <p className="text-xs text-muted-foreground">
                        💡 Higher denominations = faster spray but fewer notes. Lower = more notes, longer spray!
                      </p>
                    </div>
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
