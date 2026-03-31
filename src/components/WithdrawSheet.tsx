import { useState } from "react";
import { motion, AnimatePresence } from "framer-motion";
import { Wallet, Building2, AlertCircle, Check, ArrowRight, Shield, Coins, Globe } from "lucide-react";
import { Sheet, SheetContent, SheetHeader, SheetTitle, SheetDescription } from "@/components/ui/sheet";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { useBankAccounts, BankAccount } from "@/hooks/useBankAccounts";
import { toast } from "sonner";
import { Currency, KYCLevel, KYC_GATES } from "@/types/finance";

interface WithdrawSheetProps {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  onOpenBankAccounts: () => void;
  onOpenKYC: () => void;
  activeCurrency: Currency;
  kycLevel: KYCLevel;
  ngnBalance: number;
  usdtBalance: number;
  onWithdrawNGN: (amount: number, bankName: string, accountNumber: string, fee: number) => void;
  onWithdrawUSDT: (amount: number, toAddress: string, network: string, provider: "blockradar" | "quidax", fee: number) => void;
}

type WithdrawStep = "currency" | "amount" | "usdt-address" | "confirm" | "processing" | "success";

const NGN_QUICK_AMOUNTS = [5000, 10000, 20000, 50000, 100000];
const USDT_QUICK_AMOUNTS = [5, 10, 25, 50, 100];
const WITHDRAWAL_FEE_PERCENT = 1.5;
const USDT_WITHDRAWAL_FEE = 1; // $1 flat fee

const USDT_NETWORKS = [
  { id: "TRC20", name: "Tron (TRC20)", fee: "$1" },
  { id: "BEP20", name: "BSC (BEP20)", fee: "$1" },
  { id: "ERC20", name: "Ethereum (ERC20)", fee: "$5" },
];

export const WithdrawSheet = ({
  open,
  onOpenChange,
  onOpenBankAccounts,
  onOpenKYC,
  activeCurrency,
  kycLevel,
  ngnBalance,
  usdtBalance,
  onWithdrawNGN,
  onWithdrawUSDT,
}: WithdrawSheetProps) => {
  const { accounts, getDefaultAccount } = useBankAccounts();
  const [currency, setCurrency] = useState<Currency>(activeCurrency);
  const [step, setStep] = useState<WithdrawStep>("amount");
  const [amount, setAmount] = useState("");
  const [selectedAccount, setSelectedAccount] = useState<BankAccount | null>(null);
  const [pin, setPin] = useState("");
  const [toAddress, setToAddress] = useState("");
  const [selectedNetwork, setSelectedNetwork] = useState("TRC20");

  const balance = currency === "NGN" ? ngnBalance : usdtBalance;
  const symbol = currency === "NGN" ? "₦" : "$";
  const numericAmount = parseFloat(amount) || 0;
  const fee = currency === "NGN" ? Math.ceil(numericAmount * (WITHDRAWAL_FEE_PERCENT / 100)) : USDT_WITHDRAWAL_FEE;
  const totalDeduction = numericAmount + fee;
  const canWithdraw = currency === "NGN"
    ? numericAmount >= 1000 && totalDeduction <= balance
    : numericAmount >= 2 && totalDeduction <= balance;

  const handleAmountChange = (value: string) => {
    const cleaned = value.replace(/[^0-9.]/g, "");
    setAmount(cleaned);
  };

  // KYC Gate
  if (kycLevel < KYC_GATES.WITHDRAW_NGN) {
    return (
      <Sheet open={open} onOpenChange={onOpenChange}>
        <SheetContent side="bottom" className="h-[50dvh] max-h-[50dvh] rounded-t-3xl bg-background">
          <div className="flex h-full flex-col items-center justify-center px-6 text-center">
            <div className="w-20 h-20 rounded-full bg-primary/10 flex items-center justify-center mb-4">
              <Shield className="w-10 h-10 text-primary" />
            </div>
            <h2 className="text-xl font-bold mb-2">Complete Full Verification</h2>
            <p className="text-muted-foreground mb-2">
              Level 3 KYC (NIN + Selfie) is required to withdraw funds.
            </p>
            <p className="text-sm text-muted-foreground mb-6">
              Current level: {kycLevel}/3
            </p>
            <Button onClick={() => { onOpenChange(false); onOpenKYC(); }}>
              Complete Verification
            </Button>
          </div>
        </SheetContent>
      </Sheet>
    );
  }

  // NGN requires bank account
  if (currency === "NGN" && accounts.length === 0 && step === "amount") {
    return (
      <Sheet open={open} onOpenChange={onOpenChange}>
        <SheetContent side="bottom" className="h-[50dvh] max-h-[50dvh] rounded-t-3xl bg-background">
          <div className="flex h-full flex-col items-center justify-center px-6 text-center">
            <div className="w-20 h-20 rounded-full bg-primary/10 flex items-center justify-center mb-4">
              <Building2 className="w-10 h-10 text-primary" />
            </div>
            <h2 className="text-xl font-bold mb-2">Add a Bank Account</h2>
            <p className="text-muted-foreground mb-6">Link a bank account to withdraw NGN.</p>
            <div className="flex gap-3">
              <Button variant="outline" onClick={() => setCurrency("USDT")}>
                <Coins className="w-4 h-4 mr-2" /> Withdraw USDT
              </Button>
              <Button onClick={() => { onOpenChange(false); onOpenBankAccounts(); }}>
                Add Bank
              </Button>
            </div>
          </div>
        </SheetContent>
      </Sheet>
    );
  }

  const handleProceed = () => {
    if (currency === "NGN") {
      if (!selectedAccount) {
        const defaultAcc = getDefaultAccount();
        if (defaultAcc) setSelectedAccount(defaultAcc);
      }
      setStep("confirm");
    } else {
      setStep("usdt-address");
    }
  };

  const handleUSDTProceed = () => {
    if (!toAddress || toAddress.length < 20) {
      toast.error("Enter a valid wallet address");
      return;
    }
    setStep("confirm");
  };

  const handleConfirm = async () => {
    if (pin.length !== 4) {
      toast.error("Enter your 4-digit PIN");
      return;
    }

    setStep("processing");
    await new Promise((r) => setTimeout(r, 2000));

    try {
      if (currency === "NGN" && selectedAccount) {
        onWithdrawNGN(numericAmount, selectedAccount.bankName, selectedAccount.accountNumber, fee);
      } else if (currency === "USDT") {
        onWithdrawUSDT(numericAmount, toAddress, selectedNetwork, "blockradar", fee);
      }
      setStep("success");
    } catch {
      toast.error("Withdrawal failed");
      setStep("amount");
    }
  };

  const resetAndClose = () => {
    setStep("amount");
    setAmount("");
    setSelectedAccount(null);
    setPin("");
    setToAddress("");
    setCurrency(activeCurrency);
    onOpenChange(false);
  };

  const quickAmounts = currency === "NGN" ? NGN_QUICK_AMOUNTS : USDT_QUICK_AMOUNTS;

  return (
    <Sheet open={open} onOpenChange={onOpenChange}>
      <SheetContent
        side="bottom"
        className="flex h-[90dvh] max-h-[90dvh] flex-col overflow-hidden rounded-t-3xl bg-background"
      >
        <SheetHeader className="shrink-0 text-left pb-4">
          <SheetTitle className="flex items-center gap-2 text-2xl font-bold">
            <Wallet className="h-6 w-6 text-primary" />
            Withdraw {currency}
          </SheetTitle>
          <SheetDescription>
            {currency === "NGN" ? "Transfer to your bank account (Monnify)" : "Send USDT externally (Blockradar)"}
          </SheetDescription>
        </SheetHeader>

        {/* Currency Toggle */}
        <div className="mb-4 flex shrink-0 gap-2">
          <button
            onClick={() => setCurrency("NGN")}
            className={`px-3 py-1.5 rounded-full text-xs font-bold transition-all ${
              currency === "NGN" ? "bg-primary text-primary-foreground" : "bg-muted text-muted-foreground"
            }`}
          >
            🇳🇬 NGN
          </button>
          <button
            onClick={() => setCurrency("USDT")}
            className={`px-3 py-1.5 rounded-full text-xs font-bold transition-all ${
              currency === "USDT" ? "bg-emerald-500 text-white" : "bg-muted text-muted-foreground"
            }`}
          >
            💎 USDT
          </button>
        </div>

        <div className="min-h-0 flex-1 overflow-y-auto overscroll-y-contain pb-6 [-webkit-overflow-scrolling:touch]">
          <AnimatePresence mode="sync">
            {/* Amount */}
            {step === "amount" && (
              <motion.div key="amount" initial={{ opacity: 0 }} animate={{ opacity: 1 }} exit={{ opacity: 0 }} className="space-y-6">
                <div className="p-4 rounded-2xl bg-gradient-to-r from-primary/20 to-accent/20 text-center">
                  <p className="text-sm text-muted-foreground">Available {currency} Balance</p>
                  <p className="text-3xl font-black">
                    {symbol}{currency === "USDT" ? balance.toFixed(2) : balance.toLocaleString()}
                  </p>
                </div>

                <div className="space-y-2">
                  <Label>Amount to Withdraw</Label>
                  <div className="relative">
                    <span className="absolute left-4 top-1/2 -translate-y-1/2 text-xl font-bold text-muted-foreground">{symbol}</span>
                    <Input
                      type="text"
                      inputMode="decimal"
                      placeholder="0"
                      value={amount}
                      onChange={(e) => handleAmountChange(e.target.value)}
                      className="pl-10 text-2xl font-bold h-16 text-center"
                    />
                  </div>
                </div>

                <div className="flex flex-wrap gap-2">
                  {quickAmounts.map((amt) => (
                    <Button key={amt} variant="outline" size="sm" onClick={() => setAmount(amt.toString())}
                      className={amount === amt.toString() ? "border-primary bg-primary/10" : ""}>
                      {symbol}{amt.toLocaleString()}
                    </Button>
                  ))}
                </div>

                {/* NGN Bank Account Selection */}
                {currency === "NGN" && accounts.length > 0 && (
                  <div className="space-y-2">
                    <Label>Withdraw To</Label>
                    {accounts.map((account) => (
                      <button key={account.id} onClick={() => setSelectedAccount(account)}
                        className={`w-full p-4 rounded-xl border-2 transition-all text-left flex items-center gap-3 ${
                          (selectedAccount?.id || getDefaultAccount()?.id) === account.id
                            ? "border-primary bg-primary/10" : "border-border bg-card hover:border-primary/50"
                        }`}>
                        <Building2 className="w-5 h-5 text-primary" />
                        <div className="flex-1">
                          <p className="font-medium">{account.bankName}</p>
                          <p className="text-sm text-muted-foreground">****{account.accountNumber.slice(-4)}</p>
                        </div>
                        {((selectedAccount?.id || getDefaultAccount()?.id) === account.id) && <Check className="w-5 h-5 text-primary" />}
                      </button>
                    ))}
                  </div>
                )}

                {numericAmount > 0 && (
                  <motion.div initial={{ opacity: 0 }} animate={{ opacity: 1 }} className="p-4 rounded-xl bg-card border border-border space-y-2">
                    <div className="flex justify-between text-sm">
                      <span className="text-muted-foreground">Amount</span>
                      <span>{symbol}{numericAmount.toLocaleString()}</span>
                    </div>
                    <div className="flex justify-between text-sm">
                      <span className="text-muted-foreground">Fee {currency === "NGN" ? `(${WITHDRAWAL_FEE_PERCENT}%)` : "(flat)"}</span>
                      <span>{symbol}{fee.toLocaleString()}</span>
                    </div>
                    <div className="border-t pt-2 flex justify-between font-bold">
                      <span>Total</span><span>{symbol}{totalDeduction.toLocaleString()}</span>
                    </div>
                  </motion.div>
                )}

                {numericAmount > 0 && !canWithdraw && (
                  <p className="text-sm text-destructive flex items-center gap-2">
                    <AlertCircle className="w-4 h-4" />
                    {totalDeduction > balance ? "Insufficient balance" : currency === "NGN" ? "Minimum ₦1,000" : "Minimum $2"}
                  </p>
                )}

                <Button className="w-full" size="lg" disabled={!canWithdraw} onClick={handleProceed}>
                  Continue <ArrowRight className="w-5 h-5 ml-2" />
                </Button>
              </motion.div>
            )}

            {/* USDT Address */}
            {step === "usdt-address" && (
              <motion.div key="usdt-address" initial={{ opacity: 0 }} animate={{ opacity: 1 }} exit={{ opacity: 0 }} className="space-y-6">
                <div className="text-center py-4">
                  <Globe className="w-10 h-10 text-emerald-500 mx-auto mb-3" />
                  <p className="font-bold text-lg">Send ${numericAmount} USDT</p>
                </div>

                <div className="space-y-2">
                  <Label>Network</Label>
                  <div className="flex gap-2">
                    {USDT_NETWORKS.map((net) => (
                      <button key={net.id} onClick={() => setSelectedNetwork(net.id)}
                        className={`flex-1 p-3 rounded-xl border-2 text-center transition-all ${
                          selectedNetwork === net.id ? "border-emerald-500 bg-emerald-500/10" : "border-border"
                        }`}>
                        <p className="text-xs font-bold">{net.id}</p>
                        <p className="text-xs text-muted-foreground">{net.fee}</p>
                      </button>
                    ))}
                  </div>
                </div>

                <div className="space-y-2">
                  <Label>Recipient Wallet Address</Label>
                  <Input
                    placeholder={selectedNetwork === "TRC20" ? "T..." : "0x..."}
                    value={toAddress}
                    onChange={(e) => setToAddress(e.target.value)}
                    className="font-mono text-sm"
                  />
                </div>

                <div className="flex gap-3">
                  <Button variant="outline" className="flex-1" onClick={() => setStep("amount")}>Back</Button>
                  <Button className="flex-1" onClick={handleUSDTProceed} disabled={toAddress.length < 20}>Continue</Button>
                </div>
              </motion.div>
            )}

            {/* Confirm */}
            {step === "confirm" && (
              <motion.div key="confirm" initial={{ opacity: 0 }} animate={{ opacity: 1 }} exit={{ opacity: 0 }} className="space-y-6">
                <div className="text-center py-6">
                  <div className="w-20 h-20 mx-auto rounded-full bg-primary/10 flex items-center justify-center mb-4">
                    <Wallet className="w-10 h-10 text-primary" />
                  </div>
                  <p className="text-muted-foreground">You're withdrawing</p>
                  <p className="text-4xl font-black">{symbol}{numericAmount.toLocaleString()}</p>
                  {currency === "USDT" && (
                    <p className="text-sm text-muted-foreground mt-2 font-mono">
                      To: {toAddress.slice(0, 10)}...{toAddress.slice(-6)}
                    </p>
                  )}
                  {currency === "NGN" && selectedAccount && (
                    <p className="text-sm text-muted-foreground mt-2">
                      To: {selectedAccount.bankName} - {selectedAccount.accountName}
                    </p>
                  )}
                </div>

                <div className="space-y-2">
                  <Label>Enter PIN to Confirm</Label>
                  <Input type="password" inputMode="numeric" placeholder="••••" value={pin}
                    onChange={(e) => setPin(e.target.value.replace(/\D/g, "").slice(0, 4))}
                    maxLength={4} className="text-center text-2xl tracking-[1em] font-bold" />
                </div>

                <div className="flex gap-3">
                  <Button variant="outline" className="flex-1" onClick={() => setStep(currency === "USDT" ? "usdt-address" : "amount")}>Back</Button>
                  <Button className="flex-1" onClick={handleConfirm} disabled={pin.length !== 4}>Confirm</Button>
                </div>
              </motion.div>
            )}

            {/* Processing */}
            {step === "processing" && (
              <motion.div key="processing" initial={{ opacity: 0 }} animate={{ opacity: 1 }} className="flex flex-col items-center justify-center py-16">
                <motion.div animate={{ rotate: 360 }} transition={{ duration: 1, repeat: Infinity, ease: "linear" }}
                  className="w-16 h-16 border-4 border-primary border-t-transparent rounded-full mb-6" />
                <p className="text-xl font-bold">
                  {currency === "NGN" ? "Processing via Monnify..." : "Submitting to Blockradar..."}
                </p>
                <p className="text-muted-foreground">Please wait</p>
              </motion.div>
            )}

            {/* Success */}
            {step === "success" && (
              <motion.div key="success" initial={{ opacity: 0, scale: 0.9 }} animate={{ opacity: 1, scale: 1 }}
                className="flex flex-col items-center justify-center py-12 text-center">
                <motion.div initial={{ scale: 0 }} animate={{ scale: 1 }} transition={{ type: "spring", delay: 0.2 }}
                  className="w-24 h-24 rounded-full bg-success/20 flex items-center justify-center mb-4">
                  <Check className="w-12 h-12 text-success" />
                </motion.div>
                <h3 className="text-2xl font-bold mb-2">Withdrawal Initiated! 🎉</h3>
                <p className="text-4xl font-black mb-2">{symbol}{numericAmount.toLocaleString()}</p>
                <p className="text-muted-foreground mb-6">
                  {currency === "NGN"
                    ? `On its way to ${selectedAccount?.bankName}`
                    : `USDT sent via ${selectedNetwork}`}
                </p>
                <Button onClick={resetAndClose}>Done</Button>
              </motion.div>
            )}
          </AnimatePresence>
        </div>
      </SheetContent>
    </Sheet>
  );
};
