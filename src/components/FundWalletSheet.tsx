import { useState } from "react";
import { motion, AnimatePresence } from "framer-motion";
import { X, Building2, CreditCard, Copy, Check, ArrowLeft } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { toast } from "sonner";

interface FundWalletSheetProps {
  isOpen: boolean;
  onClose: () => void;
  onFundComplete: (amount: number, method: "bank" | "card", description: string) => void;
}

type Step = "method" | "bank" | "card" | "amount";

const QUICK_AMOUNTS = [5000, 10000, 20000, 50000, 100000];

export const FundWalletSheet = ({ isOpen, onClose, onFundComplete }: FundWalletSheetProps) => {
  const [step, setStep] = useState<Step>("method");
  const [method, setMethod] = useState<"bank" | "card" | null>(null);
  const [amount, setAmount] = useState<string>("");
  const [copied, setCopied] = useState(false);
  const [isProcessing, setIsProcessing] = useState(false);

  // Demo bank details
  const bankDetails = {
    bankName: "Wema Bank",
    accountNumber: "7821234567",
    accountName: "DOINGS/Champion User",
  };

  const handleCopy = (text: string) => {
    navigator.clipboard.writeText(text);
    setCopied(true);
    toast.success("Copied to clipboard!");
    setTimeout(() => setCopied(false), 2000);
  };

  const handleSelectMethod = (selectedMethod: "bank" | "card") => {
    setMethod(selectedMethod);
    setStep("amount");
  };

  const handleAmountSelect = (value: number) => {
    setAmount(value.toString());
  };

  const handleProceed = () => {
    const numAmount = parseInt(amount);
    if (!numAmount || numAmount < 100) {
      toast.error("Minimum amount is ₦100");
      return;
    }

    if (method === "bank") {
      setStep("bank");
    } else {
      setStep("card");
    }
  };

  const handleBankConfirm = () => {
    const numAmount = parseInt(amount);
    setIsProcessing(true);
    
    // Simulate bank transfer verification
    setTimeout(() => {
      onFundComplete(numAmount, "bank", `Bank Transfer - ${bankDetails.bankName}`);
      toast.success(`₦${numAmount.toLocaleString()} added to your wallet!`);
      handleReset();
    }, 2000);
  };

  const handleCardPayment = () => {
    const numAmount = parseInt(amount);
    setIsProcessing(true);
    
    // Simulate card payment
    setTimeout(() => {
      onFundComplete(numAmount, "card", "Card Payment - **** 4242");
      toast.success(`₦${numAmount.toLocaleString()} added to your wallet!`);
      handleReset();
    }, 2000);
  };

  const handleReset = () => {
    setStep("method");
    setMethod(null);
    setAmount("");
    setIsProcessing(false);
    onClose();
  };

  const handleBack = () => {
    if (step === "amount") setStep("method");
    else if (step === "bank" || step === "card") setStep("amount");
  };

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
                {step !== "method" && (
                  <button
                    onClick={handleBack}
                    className="p-2 hover:bg-muted rounded-full transition-colors"
                  >
                    <ArrowLeft className="w-5 h-5 text-muted-foreground" />
                  </button>
                )}
                <h2 className="text-xl font-bold text-foreground">
                  {step === "method" && "Fund Wallet"}
                  {step === "amount" && "Enter Amount"}
                  {step === "bank" && "Bank Transfer"}
                  {step === "card" && "Card Payment"}
                </h2>
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
                {/* Step 1: Select Method */}
                {step === "method" && (
                  <motion.div
                    key="method"
                    initial={{ opacity: 0, x: -20 }}
                    animate={{ opacity: 1, x: 0 }}
                    exit={{ opacity: 0, x: 20 }}
                    className="space-y-4"
                  >
                    <p className="text-muted-foreground text-sm mb-6">
                      Choose how you'd like to fund your wallet
                    </p>

                    <motion.button
                      className="w-full p-4 glass rounded-2xl flex items-center gap-4 hover:bg-card-elevated transition-colors"
                      whileHover={{ scale: 1.02 }}
                      whileTap={{ scale: 0.98 }}
                      onClick={() => handleSelectMethod("bank")}
                    >
                      <div className="w-14 h-14 rounded-2xl bg-success/20 flex items-center justify-center">
                        <Building2 className="w-7 h-7 text-success" />
                      </div>
                      <div className="text-left flex-1">
                        <h3 className="font-bold text-foreground">Bank Transfer</h3>
                        <p className="text-sm text-muted-foreground">
                          Transfer to your unique account
                        </p>
                      </div>
                      <span className="text-xs text-success font-medium bg-success/10 px-2 py-1 rounded-full">
                        No fees
                      </span>
                    </motion.button>

                    <motion.button
                      className="w-full p-4 glass rounded-2xl flex items-center gap-4 hover:bg-card-elevated transition-colors"
                      whileHover={{ scale: 1.02 }}
                      whileTap={{ scale: 0.98 }}
                      onClick={() => handleSelectMethod("card")}
                    >
                      <div className="w-14 h-14 rounded-2xl bg-secondary/20 flex items-center justify-center">
                        <CreditCard className="w-7 h-7 text-secondary" />
                      </div>
                      <div className="text-left flex-1">
                        <h3 className="font-bold text-foreground">Card Payment</h3>
                        <p className="text-sm text-muted-foreground">
                          Debit/Credit card • Instant
                        </p>
                      </div>
                      <span className="text-xs text-muted-foreground font-medium bg-muted px-2 py-1 rounded-full">
                        1.5% fee
                      </span>
                    </motion.button>
                  </motion.div>
                )}

                {/* Step 2: Enter Amount */}
                {step === "amount" && (
                  <motion.div
                    key="amount"
                    initial={{ opacity: 0, x: -20 }}
                    animate={{ opacity: 1, x: 0 }}
                    exit={{ opacity: 0, x: 20 }}
                    className="space-y-6"
                  >
                    <div className="text-center">
                      <p className="text-muted-foreground text-sm mb-4">
                        How much do you want to add?
                      </p>
                      <div className="relative">
                        <span className="absolute left-4 top-1/2 -translate-y-1/2 text-3xl font-bold text-muted-foreground">
                          ₦
                        </span>
                        <Input
                          type="number"
                          value={amount}
                          onChange={(e) => setAmount(e.target.value)}
                          placeholder="0"
                          className="text-center text-4xl font-black h-20 pl-12 bg-muted border-none"
                        />
                      </div>
                    </div>

                    <div className="flex flex-wrap gap-2 justify-center">
                      {QUICK_AMOUNTS.map((quickAmount) => (
                        <motion.button
                          key={quickAmount}
                          className={`px-4 py-2 rounded-full text-sm font-semibold transition-colors ${
                            amount === quickAmount.toString()
                              ? "bg-primary text-primary-foreground"
                              : "bg-muted text-foreground hover:bg-muted/80"
                          }`}
                          whileHover={{ scale: 1.05 }}
                          whileTap={{ scale: 0.95 }}
                          onClick={() => handleAmountSelect(quickAmount)}
                        >
                          ₦{quickAmount.toLocaleString()}
                        </motion.button>
                      ))}
                    </div>

                    {method === "card" && amount && parseInt(amount) > 0 && (
                      <div className="glass rounded-xl p-3 flex justify-between items-center">
                        <span className="text-sm text-muted-foreground">Processing fee (1.5%)</span>
                        <span className="text-sm font-semibold text-foreground">
                          ₦{Math.round(parseInt(amount) * 0.015).toLocaleString()}
                        </span>
                      </div>
                    )}

                    <Button
                      variant="gold"
                      size="lg"
                      className="w-full"
                      onClick={handleProceed}
                      disabled={!amount || parseInt(amount) < 100}
                    >
                      Continue
                    </Button>
                  </motion.div>
                )}

                {/* Step 3a: Bank Transfer Details */}
                {step === "bank" && (
                  <motion.div
                    key="bank"
                    initial={{ opacity: 0, x: -20 }}
                    animate={{ opacity: 1, x: 0 }}
                    exit={{ opacity: 0, x: 20 }}
                    className="space-y-6"
                  >
                    <div className="text-center mb-6">
                      <div className="w-16 h-16 mx-auto mb-4 rounded-full bg-success/20 flex items-center justify-center">
                        <Building2 className="w-8 h-8 text-success" />
                      </div>
                      <p className="text-muted-foreground text-sm">
                        Transfer exactly <span className="text-primary font-bold">₦{parseInt(amount).toLocaleString()}</span> to this account
                      </p>
                    </div>

                    <div className="glass rounded-2xl p-4 space-y-4">
                      <div className="flex justify-between items-center">
                        <div>
                          <p className="text-xs text-muted-foreground">Bank Name</p>
                          <p className="font-bold text-foreground">{bankDetails.bankName}</p>
                        </div>
                      </div>

                      <div className="flex justify-between items-center">
                        <div>
                          <p className="text-xs text-muted-foreground">Account Number</p>
                          <p className="font-bold text-foreground text-lg">{bankDetails.accountNumber}</p>
                        </div>
                        <button
                          onClick={() => handleCopy(bankDetails.accountNumber)}
                          className="p-2 hover:bg-muted rounded-lg transition-colors"
                        >
                          {copied ? (
                            <Check className="w-5 h-5 text-success" />
                          ) : (
                            <Copy className="w-5 h-5 text-muted-foreground" />
                          )}
                        </button>
                      </div>

                      <div className="flex justify-between items-center">
                        <div>
                          <p className="text-xs text-muted-foreground">Account Name</p>
                          <p className="font-bold text-foreground">{bankDetails.accountName}</p>
                        </div>
                      </div>
                    </div>

                    <div className="glass rounded-xl p-3 border-l-4 border-primary">
                      <p className="text-xs text-muted-foreground">
                        💡 Your wallet will be credited automatically once we confirm your transfer
                      </p>
                    </div>

                    <Button
                      variant="gold"
                      size="lg"
                      className="w-full"
                      onClick={handleBankConfirm}
                      disabled={isProcessing}
                    >
                      {isProcessing ? (
                        <motion.div
                          className="flex items-center gap-2"
                          animate={{ opacity: [1, 0.5, 1] }}
                          transition={{ duration: 1, repeat: Infinity }}
                        >
                          <div className="w-5 h-5 border-2 border-primary-foreground border-t-transparent rounded-full animate-spin" />
                          Verifying Transfer...
                        </motion.div>
                      ) : (
                        "I've Made the Transfer"
                      )}
                    </Button>
                  </motion.div>
                )}

                {/* Step 3b: Card Payment */}
                {step === "card" && (
                  <motion.div
                    key="card"
                    initial={{ opacity: 0, x: -20 }}
                    animate={{ opacity: 1, x: 0 }}
                    exit={{ opacity: 0, x: 20 }}
                    className="space-y-6"
                  >
                    <div className="text-center mb-6">
                      <div className="w-16 h-16 mx-auto mb-4 rounded-full bg-secondary/20 flex items-center justify-center">
                        <CreditCard className="w-8 h-8 text-secondary" />
                      </div>
                      <p className="text-muted-foreground text-sm">
                        Pay <span className="text-primary font-bold">₦{parseInt(amount).toLocaleString()}</span> with your card
                      </p>
                    </div>

                    <div className="space-y-4">
                      <div>
                        <label className="text-sm text-muted-foreground mb-2 block">Card Number</label>
                        <Input
                          placeholder="1234 5678 9012 3456"
                          className="bg-muted border-none"
                          defaultValue="4242 4242 4242 4242"
                        />
                      </div>

                      <div className="grid grid-cols-2 gap-4">
                        <div>
                          <label className="text-sm text-muted-foreground mb-2 block">Expiry</label>
                          <Input
                            placeholder="MM/YY"
                            className="bg-muted border-none"
                            defaultValue="12/28"
                          />
                        </div>
                        <div>
                          <label className="text-sm text-muted-foreground mb-2 block">CVV</label>
                          <Input
                            type="password"
                            placeholder="•••"
                            className="bg-muted border-none"
                            defaultValue="123"
                          />
                        </div>
                      </div>
                    </div>

                    <div className="glass rounded-xl p-3 space-y-2">
                      <div className="flex justify-between text-sm">
                        <span className="text-muted-foreground">Amount</span>
                        <span className="text-foreground">₦{parseInt(amount).toLocaleString()}</span>
                      </div>
                      <div className="flex justify-between text-sm">
                        <span className="text-muted-foreground">Fee (1.5%)</span>
                        <span className="text-foreground">₦{Math.round(parseInt(amount) * 0.015).toLocaleString()}</span>
                      </div>
                      <div className="border-t border-border pt-2 flex justify-between">
                        <span className="font-bold text-foreground">Total</span>
                        <span className="font-bold text-primary">
                          ₦{(parseInt(amount) + Math.round(parseInt(amount) * 0.015)).toLocaleString()}
                        </span>
                      </div>
                    </div>

                    <Button
                      variant="gold"
                      size="lg"
                      className="w-full"
                      onClick={handleCardPayment}
                      disabled={isProcessing}
                    >
                      {isProcessing ? (
                        <motion.div
                          className="flex items-center gap-2"
                          animate={{ opacity: [1, 0.5, 1] }}
                          transition={{ duration: 1, repeat: Infinity }}
                        >
                          <div className="w-5 h-5 border-2 border-primary-foreground border-t-transparent rounded-full animate-spin" />
                          Processing Payment...
                        </motion.div>
                      ) : (
                        `Pay ₦${(parseInt(amount) + Math.round(parseInt(amount) * 0.015)).toLocaleString()}`
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
