import { useState } from "react";
import { motion, AnimatePresence } from "framer-motion";
import { Wallet, Building2, AlertCircle, Check, ArrowRight, Shield } from "lucide-react";
import { Sheet, SheetContent, SheetHeader, SheetTitle, SheetDescription } from "@/components/ui/sheet";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { useBankAccounts, BankAccount } from "@/hooks/useBankAccounts";
import { useWallet } from "@/hooks/useWallet";
import { toast } from "sonner";

interface WithdrawSheetProps {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  onOpenBankAccounts: () => void;
  onOpenKYC: () => void;
}

type WithdrawStep = "amount" | "confirm" | "processing" | "success";

const QUICK_AMOUNTS = [5000, 10000, 20000, 50000, 100000];
const WITHDRAWAL_FEE_PERCENT = 1.5; // 1.5% fee

export const WithdrawSheet = ({ 
  open, 
  onOpenChange, 
  onOpenBankAccounts,
  onOpenKYC 
}: WithdrawSheetProps) => {
  const { accounts, kycStatus, getDefaultAccount } = useBankAccounts();
  const { balance, withdraw } = useWallet();
  const [step, setStep] = useState<WithdrawStep>("amount");
  const [amount, setAmount] = useState("");
  const [selectedAccount, setSelectedAccount] = useState<BankAccount | null>(null);
  const [pin, setPin] = useState("");

  const numericAmount = parseFloat(amount) || 0;
  const fee = Math.ceil(numericAmount * (WITHDRAWAL_FEE_PERCENT / 100));
  const totalDeduction = numericAmount + fee;
  const canWithdraw = numericAmount >= 1000 && totalDeduction <= balance;

  const handleAmountChange = (value: string) => {
    const cleaned = value.replace(/[^0-9]/g, "");
    setAmount(cleaned);
  };

  const handleSelectAccount = (account: BankAccount) => {
    setSelectedAccount(account);
  };

  const handleProceed = () => {
    if (!selectedAccount) {
      const defaultAcc = getDefaultAccount();
      if (defaultAcc) {
        setSelectedAccount(defaultAcc);
      }
    }
    setStep("confirm");
  };

  const handleConfirm = async () => {
    if (pin.length !== 4) {
      toast.error("Please enter your 4-digit PIN");
      return;
    }

    setStep("processing");

    try {
      await new Promise((resolve) => setTimeout(resolve, 2000));
      
      if (selectedAccount) {
        withdraw(numericAmount, selectedAccount.bankName, selectedAccount.accountNumber);
      }
      
      setStep("success");
    } catch (error) {
      toast.error("Withdrawal failed. Please try again.");
      setStep("amount");
    }
  };

  const resetAndClose = () => {
    setStep("amount");
    setAmount("");
    setSelectedAccount(null);
    setPin("");
    onOpenChange(false);
  };

  // Check prerequisites
  if (kycStatus !== "verified") {
    return (
      <Sheet open={open} onOpenChange={onOpenChange}>
        <SheetContent side="bottom" className="h-[50vh] rounded-t-3xl bg-background">
          <div className="flex flex-col items-center justify-center h-full text-center px-6">
            <div className="w-20 h-20 rounded-full bg-primary/10 flex items-center justify-center mb-4">
              <Shield className="w-10 h-10 text-primary" />
            </div>
            <h2 className="text-xl font-bold mb-2">Verify Your Identity</h2>
            <p className="text-muted-foreground mb-6">
              Complete KYC verification to withdraw funds from your wallet.
            </p>
            <Button onClick={() => { onOpenChange(false); onOpenKYC(); }}>
              Start Verification
            </Button>
          </div>
        </SheetContent>
      </Sheet>
    );
  }

  if (accounts.length === 0) {
    return (
      <Sheet open={open} onOpenChange={onOpenChange}>
        <SheetContent side="bottom" className="h-[50vh] rounded-t-3xl bg-background">
          <div className="flex flex-col items-center justify-center h-full text-center px-6">
            <div className="w-20 h-20 rounded-full bg-primary/10 flex items-center justify-center mb-4">
              <Building2 className="w-10 h-10 text-primary" />
            </div>
            <h2 className="text-xl font-bold mb-2">Add a Bank Account</h2>
            <p className="text-muted-foreground mb-6">
              Link a bank account to withdraw funds to.
            </p>
            <Button onClick={() => { onOpenChange(false); onOpenBankAccounts(); }}>
              Add Bank Account
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
            <Wallet className="w-6 h-6 text-primary" />
            Withdraw Funds
          </SheetTitle>
          <SheetDescription>
            Transfer money to your bank account
          </SheetDescription>
        </SheetHeader>

        <div className="overflow-y-auto max-h-[70vh] pb-6">
          <AnimatePresence mode="wait">
            {/* Amount Step */}
            {step === "amount" && (
              <motion.div
                key="amount"
                initial={{ opacity: 0, x: 20 }}
                animate={{ opacity: 1, x: 0 }}
                exit={{ opacity: 0, x: -20 }}
                className="space-y-6"
              >
                {/* Balance Display */}
                <div className="p-4 rounded-2xl bg-gradient-to-r from-primary/20 to-accent/20 text-center">
                  <p className="text-sm text-muted-foreground">Available Balance</p>
                  <p className="text-3xl font-black">₦{balance.toLocaleString()}</p>
                </div>

                {/* Amount Input */}
                <div className="space-y-2">
                  <Label>Amount to Withdraw</Label>
                  <div className="relative">
                    <span className="absolute left-4 top-1/2 -translate-y-1/2 text-xl font-bold text-muted-foreground">
                      ₦
                    </span>
                    <Input
                      type="text"
                      inputMode="numeric"
                      placeholder="0"
                      value={amount ? parseInt(amount).toLocaleString() : ""}
                      onChange={(e) => handleAmountChange(e.target.value.replace(/,/g, ""))}
                      className="pl-10 text-2xl font-bold h-16 text-center"
                    />
                  </div>
                </div>

                {/* Quick Amounts */}
                <div className="flex flex-wrap gap-2">
                  {QUICK_AMOUNTS.map((amt) => (
                    <Button
                      key={amt}
                      variant="outline"
                      size="sm"
                      onClick={() => setAmount(amt.toString())}
                      className={amount === amt.toString() ? "border-primary bg-primary/10" : ""}
                    >
                      ₦{amt.toLocaleString()}
                    </Button>
                  ))}
                </div>

                {/* Bank Account Selection */}
                <div className="space-y-2">
                  <Label>Withdraw To</Label>
                  <div className="space-y-2">
                    {accounts.map((account) => (
                      <button
                        key={account.id}
                        onClick={() => handleSelectAccount(account)}
                        className={`w-full p-4 rounded-xl border-2 transition-all text-left flex items-center gap-3 ${
                          (selectedAccount?.id || getDefaultAccount()?.id) === account.id
                            ? "border-primary bg-primary/10"
                            : "border-border bg-card hover:border-primary/50"
                        }`}
                      >
                        <Building2 className="w-5 h-5 text-primary" />
                        <div className="flex-1">
                          <p className="font-medium">{account.bankName}</p>
                          <p className="text-sm text-muted-foreground">
                            {account.accountNumber.replace(/(\d{3})(\d{4})(\d{3})/, "$1****$3")}
                          </p>
                        </div>
                        {((selectedAccount?.id || getDefaultAccount()?.id) === account.id) && (
                          <Check className="w-5 h-5 text-primary" />
                        )}
                      </button>
                    ))}
                  </div>
                  <Button
                    variant="ghost"
                    size="sm"
                    className="w-full"
                    onClick={() => { onOpenChange(false); onOpenBankAccounts(); }}
                  >
                    Manage Bank Accounts
                  </Button>
                </div>

                {/* Fee Breakdown */}
                {numericAmount > 0 && (
                  <motion.div
                    initial={{ opacity: 0, y: 10 }}
                    animate={{ opacity: 1, y: 0 }}
                    className="p-4 rounded-xl bg-card border border-border space-y-2"
                  >
                    <div className="flex justify-between text-sm">
                      <span className="text-muted-foreground">Withdrawal Amount</span>
                      <span>₦{numericAmount.toLocaleString()}</span>
                    </div>
                    <div className="flex justify-between text-sm">
                      <span className="text-muted-foreground">Fee ({WITHDRAWAL_FEE_PERCENT}%)</span>
                      <span>₦{fee.toLocaleString()}</span>
                    </div>
                    <div className="border-t pt-2 flex justify-between font-bold">
                      <span>Total Deduction</span>
                      <span>₦{totalDeduction.toLocaleString()}</span>
                    </div>
                  </motion.div>
                )}

                {/* Validation Messages */}
                {numericAmount > 0 && numericAmount < 1000 && (
                  <p className="text-sm text-destructive flex items-center gap-2">
                    <AlertCircle className="w-4 h-4" />
                    Minimum withdrawal is ₦1,000
                  </p>
                )}
                {totalDeduction > balance && (
                  <p className="text-sm text-destructive flex items-center gap-2">
                    <AlertCircle className="w-4 h-4" />
                    Insufficient balance
                  </p>
                )}

                <Button
                  className="w-full"
                  size="lg"
                  disabled={!canWithdraw}
                  onClick={handleProceed}
                >
                  Continue
                  <ArrowRight className="w-5 h-5 ml-2" />
                </Button>
              </motion.div>
            )}

            {/* Confirm Step */}
            {step === "confirm" && (
              <motion.div
                key="confirm"
                initial={{ opacity: 0, x: 20 }}
                animate={{ opacity: 1, x: 0 }}
                exit={{ opacity: 0, x: -20 }}
                className="space-y-6"
              >
                <div className="text-center py-6">
                  <div className="w-20 h-20 mx-auto rounded-full bg-primary/10 flex items-center justify-center mb-4">
                    <Wallet className="w-10 h-10 text-primary" />
                  </div>
                  <p className="text-muted-foreground">You're withdrawing</p>
                  <p className="text-4xl font-black">₦{numericAmount.toLocaleString()}</p>
                </div>

                <div className="p-4 rounded-xl bg-card border border-border">
                  <p className="text-sm text-muted-foreground mb-1">To</p>
                  <div className="flex items-center gap-3">
                    <Building2 className="w-5 h-5 text-primary" />
                    <div>
                      <p className="font-medium">{selectedAccount?.bankName}</p>
                      <p className="text-sm text-muted-foreground">{selectedAccount?.accountName}</p>
                      <p className="text-sm text-muted-foreground">{selectedAccount?.accountNumber}</p>
                    </div>
                  </div>
                </div>

                <div className="space-y-2">
                  <Label>Enter PIN to Confirm</Label>
                  <Input
                    type="password"
                    inputMode="numeric"
                    placeholder="••••"
                    value={pin}
                    onChange={(e) => setPin(e.target.value.replace(/\D/g, "").slice(0, 4))}
                    maxLength={4}
                    className="text-center text-2xl tracking-[1em] font-bold"
                  />
                </div>

                <div className="flex gap-3">
                  <Button variant="outline" className="flex-1" onClick={() => setStep("amount")}>
                    Back
                  </Button>
                  <Button className="flex-1" onClick={handleConfirm} disabled={pin.length !== 4}>
                    Confirm Withdrawal
                  </Button>
                </div>
              </motion.div>
            )}

            {/* Processing Step */}
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
                <p className="text-xl font-bold">Processing Withdrawal...</p>
                <p className="text-muted-foreground">Please wait</p>
              </motion.div>
            )}

            {/* Success Step */}
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
                  className="w-24 h-24 rounded-full bg-green-500/20 flex items-center justify-center mb-4"
                >
                  <Check className="w-12 h-12 text-green-500" />
                </motion.div>
                <h3 className="text-2xl font-bold mb-2">Withdrawal Initiated! 🎉</h3>
                <p className="text-4xl font-black mb-2">₦{numericAmount.toLocaleString()}</p>
                <p className="text-muted-foreground mb-6">
                  Your money is on its way to {selectedAccount?.bankName}
                </p>
                <p className="text-sm text-muted-foreground mb-6">
                  Expected arrival: Within 24 hours
                </p>
                <Button onClick={resetAndClose}>
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
