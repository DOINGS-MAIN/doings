import { useState } from "react";
import { motion, AnimatePresence } from "framer-motion";
import { X, Building2, Copy, Check, ArrowLeft, Coins, QrCode, Globe } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { toast } from "sonner";
import { Currency, KYCLevel, KYC_GATES, MonnifyReservedAccount, BlockradarAddress } from "@/types/finance";

interface FundWalletSheetProps {
  isOpen: boolean;
  onClose: () => void;
  onFundNGN: (amount: number, description: string) => void;
  onFundUSDT: (amount: number, provider: "blockradar", description: string) => void;
  activeCurrency: Currency;
  kycLevel: KYCLevel;
  onOpenKYC: () => void;
  fundingProviderId?: string;
  ngnReservedAccount?: MonnifyReservedAccount;
  monnifyAccount?: MonnifyReservedAccount;
  onCreateNgnAccount: (bvn?: string) => Promise<MonnifyReservedAccount>;
  /** @deprecated Use onCreateNgnAccount */
  onCreateMonnifyAccount: (bvn: string) => Promise<MonnifyReservedAccount>;
  blockradarAddresses: BlockradarAddress[];
  onCreateBlockradarAddress: (network: string) => Promise<BlockradarAddress>;
}

type Step =
  | "currency"
  | "amount"
  | "monnify-bvn"
  | "bank"
  | "usdt-network"
  | "usdt-deposit";

const NGN_QUICK_AMOUNTS = [5000, 10000, 20000, 50000, 100000];
const USDT_QUICK_AMOUNTS = [10, 25, 50, 100, 500];
const USDT_NETWORKS = [
  { id: "TRC20", name: "Tron (TRC20)", fee: "~$1", speed: "Fast" },
  { id: "BEP20", name: "BSC (BEP20)", fee: "~$0.3", speed: "Fast" },
  { id: "ERC20", name: "Ethereum (ERC20)", fee: "~$5-20", speed: "Slower" },
];

export const FundWalletSheet = ({
  isOpen,
  onClose,
  onFundNGN,
  onFundUSDT,
  activeCurrency,
  kycLevel,
  onOpenKYC,
  fundingProviderId = "monnify",
  ngnReservedAccount,
  monnifyAccount,
  onCreateNgnAccount,
  onCreateMonnifyAccount,
  blockradarAddresses,
  onCreateBlockradarAddress,
}: FundWalletSheetProps) => {
  const [step, setStep] = useState<Step>("amount");
  const [currency, setCurrency] = useState<Currency>(activeCurrency);
  const [amount, setAmount] = useState<string>("");
  const [copied, setCopied] = useState(false);
  const [isProcessing, setIsProcessing] = useState(false);
  const [selectedNetwork, setSelectedNetwork] = useState<string>("");
  const [depositAddress, setDepositAddress] = useState<string>("");
  const [isCreatingAccount, setIsCreatingAccount] = useState(false);
  const [monnifyBvn, setMonnifyBvn] = useState("");

  const reservedAccount = ngnReservedAccount ?? monnifyAccount;
  const providerLabel =
    fundingProviderId === "nomba"
      ? "Nombank"
      : fundingProviderId === "monnify"
      ? "Monnify"
      : fundingProviderId === "flutterwave"
      ? "Flutterwave"
      : fundingProviderId;
  const needsBvnForAccount = fundingProviderId === "monnify" || fundingProviderId === "flutterwave";
  const bankDetails = reservedAccount || {
    bankName: "Wema Bank",
    accountNumber: "Not created yet",
    accountName: "DOINGS/User",
  };

  const handleCopy = (text: string) => {
    navigator.clipboard.writeText(text);
    setCopied(true);
    toast.success("Copied!");
    setTimeout(() => setCopied(false), 2000);
  };

  const handleSelectCurrency = (c: Currency) => {
    // Check KYC gates
    if (c === "NGN" && kycLevel < KYC_GATES.FUND_NGN) {
      toast.error("Complete Level 2 KYC to fund your NGN wallet");
      onClose();
      onOpenKYC();
      return;
    }
    if (c === "USDT" && kycLevel < KYC_GATES.RECEIVE_USDT) {
      toast.error("Complete Level 2 KYC to receive USDT");
      onClose();
      onOpenKYC();
      return;
    }

    setCurrency(c);
    if (c === "NGN") {
      setStep("amount");
    } else {
      setStep("usdt-network");
    }
  };

  const handleAmountSelect = (value: number) => {
    setAmount(value.toString());
  };

  const handleProceed = () => {
    const numAmount = parseFloat(amount);
    if (!numAmount || (currency === "NGN" && numAmount < 100)) {
      toast.error(currency === "NGN" ? "Minimum amount is ₦100" : "Enter a valid amount");
      return;
    }

    if (!reservedAccount) {
        if (needsBvnForAccount) {
          setStep("monnify-bvn");
          return;
        }
        void (async () => {
          setIsCreatingAccount(true);
          try {
            await onCreateNgnAccount();
            toast.success("Funding account created.");
            setStep("bank");
          } catch (e) {
            toast.error(e instanceof Error ? e.message : "Could not create funding account");
          } finally {
            setIsCreatingAccount(false);
          }
        })();
        return;
      }
      setStep("bank");
  };

  const handleSelectNetwork = async (networkId: string) => {
    setSelectedNetwork(networkId);
    setIsProcessing(true);

    // Check if address exists for this network
    const existing = blockradarAddresses.find((a) => a.network === networkId);
    if (existing) {
      setDepositAddress(existing.address);
      setIsProcessing(false);
      setStep("usdt-deposit");
      return;
    }

    try {
      const addr = await onCreateBlockradarAddress(networkId);
      setDepositAddress(addr.address);
      setStep("usdt-deposit");
    } catch {
      toast.error("Failed to generate address");
    } finally {
      setIsProcessing(false);
    }
  };

  const handleBankConfirm = () => {
    const numAmount = parseInt(amount, 10);
    onFundNGN(numAmount, `Bank Transfer - ${bankDetails.bankName}`);
    toast.info(
      `After you transfer, ${providerLabel} notifies us and your NGN balance updates automatically (usually within a few minutes).`
    );
    handleReset();
  };

  const handleMonnifyBvnContinue = async () => {
    const digits = monnifyBvn.replace(/\D/g, "");
    if (digits.length !== 11) {
      toast.error("Enter a valid 11-digit BVN (required for virtual account creation).");
      return;
    }
    setIsCreatingAccount(true);
    try {
      await onCreateNgnAccount(digits);
      toast.success("Reserved account created. You can copy bank details on the next step.");
      setStep("bank");
    } catch (e) {
      toast.error(e instanceof Error ? e.message : "Could not create reserved account");
    } finally {
      setIsCreatingAccount(false);
    }
  };

  const handleReset = () => {
    setStep(activeCurrency === "USDT" ? "usdt-network" : "amount");
    setAmount("");
    setIsProcessing(false);
    setIsCreatingAccount(false);
    setMonnifyBvn("");
    setSelectedNetwork("");
    setDepositAddress("");
    setCurrency(activeCurrency);
    onClose();
  };

  const handleBack = () => {
    if (step === "usdt-network") setStep("currency");
    else if (step === "amount") setStep("currency");
    else if (step === "monnify-bvn") setStep("amount");
    else if (step === "bank") setStep("amount");
    else if (step === "usdt-deposit") setStep("usdt-network");
  };

  const quickAmounts = currency === "NGN" ? NGN_QUICK_AMOUNTS : USDT_QUICK_AMOUNTS;
  const symbol = currency === "NGN" ? "₦" : "$";

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
                {step !== "currency" && step !== "amount" && (
                  <button onClick={handleBack} className="p-2 hover:bg-muted rounded-full transition-colors">
                    <ArrowLeft className="w-5 h-5 text-muted-foreground" />
                  </button>
                )}
                <h2 className="text-xl font-bold text-foreground">
                  {step === "currency" && "Fund Wallet"}
                  {step === "amount" && "Fund NGN Wallet"}
                  {step === "monnify-bvn" && "Verify BVN"}
                  {step === "bank" && "Bank Transfer"}
                  {step === "usdt-network" && "Select Network"}
                  {step === "usdt-deposit" && "Deposit USDT"}
                </h2>
              </div>
              <button onClick={handleReset} className="p-2 hover:bg-muted rounded-full transition-colors">
                <X className="w-5 h-5 text-muted-foreground" />
              </button>
            </div>

            <div className="min-h-0 flex-1 overflow-y-auto overscroll-y-contain p-6 [-webkit-overflow-scrolling:touch]">
              <AnimatePresence mode="sync">
                {/* Currency Selection (shown when entering from multi-currency) */}
                {step === "currency" && (
                  <motion.div key="currency" initial={{ opacity: 0 }} animate={{ opacity: 1 }} exit={{ opacity: 0 }} className="space-y-4">
                    <p className="text-muted-foreground text-sm mb-4">Select wallet to fund</p>
                    <motion.button
                      className="w-full p-4 glass rounded-2xl flex items-center gap-4 hover:bg-card-elevated transition-colors"
                      whileHover={{ scale: 1.02 }}
                      whileTap={{ scale: 0.98 }}
                      onClick={() => handleSelectCurrency("NGN")}
                    >
                      <div className="w-14 h-14 rounded-2xl bg-primary/20 flex items-center justify-center text-2xl">🇳🇬</div>
                      <div className="text-left flex-1">
                        <h3 className="font-bold text-foreground">Naira (NGN)</h3>
                        <p className="text-sm text-muted-foreground">Bank transfer via {providerLabel}</p>
                      </div>
                    </motion.button>
                    <motion.button
                      className="w-full p-4 glass rounded-2xl flex items-center gap-4 hover:bg-card-elevated transition-colors"
                      whileHover={{ scale: 1.02 }}
                      whileTap={{ scale: 0.98 }}
                      onClick={() => handleSelectCurrency("USDT")}
                    >
                      <div className="w-14 h-14 rounded-2xl bg-emerald-500/20 flex items-center justify-center">
                        <Coins className="w-7 h-7 text-emerald-500" />
                      </div>
                      <div className="text-left flex-1">
                        <h3 className="font-bold text-foreground">USDT (Tether)</h3>
                        <p className="text-sm text-muted-foreground">Crypto deposit (Blockradar)</p>
                      </div>
                    </motion.button>
                  </motion.div>
                )}

                {/* NGN amount */}
                {step === "amount" && currency === "NGN" && (
                  <motion.div key="amount" initial={{ opacity: 0, x: -20 }} animate={{ opacity: 1, x: 0 }} exit={{ opacity: 0, x: 20 }} className="space-y-6">
                    <p className="text-sm text-muted-foreground text-center">
                      Fund via bank transfer to your {providerLabel} virtual account
                    </p>
                    <div className="text-center">
                      <p className="text-muted-foreground text-sm mb-4">How much do you want to add?</p>
                      <div className="relative">
                        <span className="absolute left-4 top-1/2 -translate-y-1/2 text-3xl font-bold text-muted-foreground">{symbol}</span>
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
                      {quickAmounts.map((q) => (
                        <motion.button
                          key={q}
                          className={`px-4 py-2 rounded-full text-sm font-semibold transition-colors ${
                            amount === q.toString() ? "bg-primary text-primary-foreground" : "bg-muted text-foreground hover:bg-muted/80"
                          }`}
                          whileHover={{ scale: 1.05 }}
                          whileTap={{ scale: 0.95 }}
                          onClick={() => handleAmountSelect(q)}
                        >
                          {symbol}{q.toLocaleString()}
                        </motion.button>
                      ))}
                    </div>
                    <Button
                      variant="gold"
                      size="lg"
                      className="w-full"
                      onClick={handleProceed}
                      disabled={!amount || parseFloat(amount) < 100}
                    >
                      Continue
                    </Button>
                    <Button variant="ghost" className="w-full text-sm" onClick={() => setStep("currency")}>
                      <Coins className="w-4 h-4 mr-2" />
                      Fund USDT instead
                    </Button>
                  </motion.div>
                )}

                {step === "monnify-bvn" && (
                  <motion.div
                    key="monnify-bvn"
                    initial={{ opacity: 0, x: -20 }}
                    animate={{ opacity: 1, x: 0 }}
                    exit={{ opacity: 0, x: 20 }}
                    className="space-y-6"
                  >
                    <p className="text-sm text-muted-foreground">
                      {providerLabel} needs your <span className="font-medium text-foreground">BVN</span> once to generate your personal transfer account. This is not stored in plain text on our
                      servers after verification.
                    </p>
                    <div>
                      <label className="text-sm font-medium text-foreground mb-2 block">11-digit BVN</label>
                      <Input
                        inputMode="numeric"
                        autoComplete="off"
                        placeholder="12345678901"
                        value={monnifyBvn}
                        onChange={(e) => setMonnifyBvn(e.target.value.replace(/\D/g, "").slice(0, 11))}
                        className="text-center text-xl font-bold tracking-widest h-14"
                        maxLength={11}
                      />
                    </div>
                    <Button
                      variant="gold"
                      size="lg"
                      className="w-full"
                      onClick={() => void handleMonnifyBvnContinue()}
                      disabled={isCreatingAccount || monnifyBvn.replace(/\D/g, "").length !== 11}
                    >
                      {isCreatingAccount ? (
                        <span className="flex items-center justify-center gap-2">
                          <span className="h-5 w-5 border-2 border-primary-foreground border-t-transparent rounded-full animate-spin" />
                          Creating account…
                        </span>
                      ) : (
                        "Create transfer account"
                      )}
                    </Button>
                  </motion.div>
                )}

                {/* Bank Transfer Details */}
                {step === "bank" && (
                  <motion.div key="bank" initial={{ opacity: 0, x: -20 }} animate={{ opacity: 1, x: 0 }} exit={{ opacity: 0, x: 20 }} className="space-y-6">
                    <div className="text-center mb-6">
                      <div className="w-16 h-16 mx-auto mb-4 rounded-full bg-success/20 flex items-center justify-center">
                        <Building2 className="w-8 h-8 text-success" />
                      </div>
                      <p className="text-muted-foreground text-sm">
                        Transfer exactly <span className="text-primary font-bold">₦{parseInt(amount).toLocaleString()}</span> to your {providerLabel} account
                      </p>
                    </div>
                    <div className="glass rounded-2xl p-4 space-y-4">
                      <div><p className="text-xs text-muted-foreground">Bank Name</p><p className="font-bold text-foreground">{reservedAccount?.bankName || bankDetails.bankName}</p></div>
                      <div className="flex justify-between items-center">
                        <div><p className="text-xs text-muted-foreground">Account Number</p><p className="font-bold text-foreground text-lg">{reservedAccount?.accountNumber || bankDetails.accountNumber}</p></div>
                        <button onClick={() => handleCopy(reservedAccount?.accountNumber || bankDetails.accountNumber || "")} className="p-2 hover:bg-muted rounded-lg transition-colors">
                          {copied ? <Check className="w-5 h-5 text-success" /> : <Copy className="w-5 h-5 text-muted-foreground" />}
                        </button>
                      </div>
                      <div><p className="text-xs text-muted-foreground">Account Name</p><p className="font-bold text-foreground">{reservedAccount?.accountName || bankDetails.accountName}</p></div>
                    </div>
                    <div className="glass rounded-xl p-3 border-l-4 border-primary">
                      <p className="text-xs text-muted-foreground">💡 Your wallet will be credited automatically via {providerLabel} webhook</p>
                    </div>
                    <Button variant="gold" size="lg" className="w-full" onClick={handleBankConfirm} disabled={isProcessing}>
                      {isProcessing ? (
                        <motion.div className="flex items-center gap-2" animate={{ opacity: [1, 0.5, 1] }} transition={{ duration: 1, repeat: Infinity }}>
                          <div className="w-5 h-5 border-2 border-primary-foreground border-t-transparent rounded-full animate-spin" />
                          Verifying Transfer...
                        </motion.div>
                      ) : "I've Made the Transfer"}
                    </Button>
                  </motion.div>
                )}

                {/* USDT Network Selection */}
                {step === "usdt-network" && (
                  <motion.div key="usdt-network" initial={{ opacity: 0, x: -20 }} animate={{ opacity: 1, x: 0 }} exit={{ opacity: 0, x: 20 }} className="space-y-4">
                    <div className="text-center mb-4">
                      <div className="w-16 h-16 mx-auto mb-4 rounded-full bg-emerald-500/20 flex items-center justify-center">
                        <Globe className="w-8 h-8 text-emerald-500" />
                      </div>
                      <h3 className="font-bold">Select Network</h3>
                      <p className="text-sm text-muted-foreground">Choose the blockchain network for your USDT deposit</p>
                    </div>
                    {USDT_NETWORKS.map((net) => (
                      <motion.button
                        key={net.id}
                        className="w-full p-4 glass rounded-2xl flex items-center gap-4 hover:bg-card-elevated transition-colors"
                        whileHover={{ scale: 1.02 }}
                        whileTap={{ scale: 0.98 }}
                        onClick={() => handleSelectNetwork(net.id)}
                        disabled={isProcessing}
                      >
                        <div className="w-12 h-12 rounded-xl bg-emerald-500/10 flex items-center justify-center">
                          <QrCode className="w-6 h-6 text-emerald-500" />
                        </div>
                        <div className="text-left flex-1">
                          <h3 className="font-bold text-foreground">{net.name}</h3>
                          <p className="text-xs text-muted-foreground">Fee: {net.fee} • {net.speed}</p>
                        </div>
                        {blockradarAddresses.find((a) => a.network === net.id) && (
                          <span className="text-xs text-success font-medium">Active</span>
                        )}
                      </motion.button>
                    ))}
                    {isProcessing && (
                      <div className="flex items-center justify-center py-4 gap-2">
                        <div className="w-4 h-4 border-2 border-primary border-t-transparent rounded-full animate-spin" />
                        <span className="text-sm text-muted-foreground">Generating address via Blockradar...</span>
                      </div>
                    )}
                    <Button variant="ghost" className="w-full text-sm" onClick={() => { setCurrency("NGN"); setStep("amount"); }}>
                      Fund NGN instead
                    </Button>
                  </motion.div>
                )}

                {/* USDT Deposit Address */}
                {step === "usdt-deposit" && (
                  <motion.div key="usdt-deposit" initial={{ opacity: 0, x: -20 }} animate={{ opacity: 1, x: 0 }} exit={{ opacity: 0, x: 20 }} className="space-y-6">
                    <div className="text-center">
                      <div className="w-16 h-16 mx-auto mb-4 rounded-full bg-emerald-500/20 flex items-center justify-center">
                        <Coins className="w-8 h-8 text-emerald-500" />
                      </div>
                      <h3 className="font-bold">Deposit USDT ({selectedNetwork})</h3>
                      <p className="text-sm text-muted-foreground">Send USDT to this address</p>
                    </div>

                    <div className="glass rounded-2xl p-4 space-y-3">
                      <p className="text-xs text-muted-foreground">Deposit Address</p>
                      <div className="flex items-center gap-2">
                        <p className="font-mono text-sm text-foreground break-all flex-1">{depositAddress}</p>
                        <button onClick={() => handleCopy(depositAddress)} className="p-2 hover:bg-muted rounded-lg transition-colors shrink-0">
                          {copied ? <Check className="w-5 h-5 text-success" /> : <Copy className="w-5 h-5 text-muted-foreground" />}
                        </button>
                      </div>
                    </div>

                    <div className="space-y-2">
                      <div className="glass rounded-xl p-3 border-l-4 border-emerald-500">
                        <p className="text-xs text-muted-foreground">
                          ⚡ Only send <span className="font-bold text-foreground">USDT</span> on the <span className="font-bold text-foreground">{selectedNetwork}</span> network
                        </p>
                      </div>
                      <div className="glass rounded-xl p-3 border-l-4 border-destructive">
                        <p className="text-xs text-muted-foreground">
                          ⚠️ Sending other tokens or wrong network will result in permanent loss
                        </p>
                      </div>
                    </div>

                    <div className="glass rounded-xl p-3">
                      <p className="text-xs text-muted-foreground">
                        💡 Deposits are auto-swept by Blockradar and credited to your wallet within minutes
                      </p>
                    </div>

                    <Button variant="outline" className="w-full" onClick={handleReset}>
                      Done
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
