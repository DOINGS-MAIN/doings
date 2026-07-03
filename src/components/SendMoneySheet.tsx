import { useCallback, useEffect, useState } from "react";
import { motion, AnimatePresence } from "framer-motion";
import { Send, Search, Check, ArrowRight, AlertCircle, AtSign, Loader2 } from "lucide-react";
import { Sheet, SheetContent, SheetHeader, SheetTitle, SheetDescription } from "@/components/ui/sheet";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { useMultiWallet } from "@/hooks/useMultiWallet";
import { transfers } from "@/lib/supabase";
import { formatUsername, normalizeUsernameInput, USERNAME_RE } from "@/lib/username";
import { PinInput } from "@/components/PinInput";
import { isValidPin, rpcErrorMessage } from "@/lib/pin";
import { P2P_TRANSFER_FEE_NAIRA } from "@/lib/transferConstants";
import { toast } from "sonner";

interface SendMoneySheetProps {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  onPinNotSet?: () => void;
}

type SendStep = "recipient" | "amount" | "confirm" | "processing" | "success";

interface Recipient {
  id: string;
  name: string;
  username: string;
  avatar: string;
}

const QUICK_AMOUNTS = [1000, 2000, 5000, 10000, 20000];

function mapLookupUser(row: {
  id: string;
  name: string;
  username: string;
  avatar?: string;
}): Recipient {
  return {
    id: row.id,
    name: row.name,
    username: row.username.startsWith("@") ? row.username : formatUsername(row.username),
    avatar: row.avatar ?? "👤",
  };
}

export const SendMoneySheet = ({ open, onOpenChange, onPinNotSet }: SendMoneySheetProps) => {
  const { ngnBalance, refreshBalances } = useMultiWallet();
  const balance = ngnBalance;
  const [step, setStep] = useState<SendStep>("recipient");
  const [searchQuery, setSearchQuery] = useState("");
  const [selectedRecipient, setSelectedRecipient] = useState<Recipient | null>(null);
  const [recentRecipients, setRecentRecipients] = useState<Recipient[]>([]);
  const [recentLoading, setRecentLoading] = useState(false);
  const [searching, setSearching] = useState(false);
  const [amount, setAmount] = useState("");
  const [note, setNote] = useState("");
  const [pin, setPin] = useState("");

  const normalizedSearch = normalizeUsernameInput(searchQuery);
  const numericAmount = parseFloat(amount) || 0;
  const canSend = numericAmount >= 100 && numericAmount <= balance;

  const loadRecentRecipients = useCallback(async () => {
    setRecentLoading(true);
    try {
      const res = (await transfers.recentRecipients()) as { recipients?: Recipient[] };
      setRecentRecipients((res.recipients ?? []).map(mapLookupUser));
    } catch {
      setRecentRecipients([]);
    } finally {
      setRecentLoading(false);
    }
  }, []);

  useEffect(() => {
    if (open) {
      void loadRecentRecipients();
    }
  }, [open, loadRecentRecipients]);

  const handleSearch = async () => {
    if (!USERNAME_RE.test(normalizedSearch)) {
      toast.error("Enter a valid username (3–30 characters)");
      return;
    }

    setSearching(true);
    try {
      const res = (await transfers.lookupUser(normalizedSearch)) as { user?: Recipient };
      if (!res.user) throw new Error("User not found");
      setSelectedRecipient(mapLookupUser(res.user));
      toast.success("User found");
    } catch (error) {
      setSelectedRecipient(null);
      toast.error(rpcErrorMessage(error, "User not found"));
    } finally {
      setSearching(false);
    }
  };

  const handleAmountChange = (value: string) => {
    const cleaned = value.replace(/[^0-9]/g, "");
    setAmount(cleaned);
  };

  const handleConfirm = async () => {
    if (!isValidPin(pin)) {
      toast.error("Enter your 4-digit transaction PIN");
      return;
    }
    if (!selectedRecipient) return;

    setStep("processing");

    try {
      const username = normalizeUsernameInput(selectedRecipient.username);
      await transfers.send(username, numericAmount, pin, "NGN", note || undefined);
      await refreshBalances();
      setStep("success");
    } catch (error) {
      const code = (error as Error & { code?: string }).code;
      if (code === "PIN_NOT_SET") onPinNotSet?.();
      toast.error(rpcErrorMessage(error, "Transfer failed. Please try again."));
      setStep("confirm");
    }
  };

  const resetAndClose = () => {
    setStep("recipient");
    setSearchQuery("");
    setSelectedRecipient(null);
    setAmount("");
    setNote("");
    setPin("");
    onOpenChange(false);
  };

  return (
    <Sheet open={open} onOpenChange={onOpenChange}>
      <SheetContent
        side="bottom"
        className="flex h-[90dvh] max-h-[90dvh] flex-col overflow-hidden rounded-t-3xl bg-background"
      >
        <SheetHeader className="shrink-0 text-left pb-4">
          <SheetTitle className="flex items-center gap-2 text-2xl font-bold">
            <Send className="h-6 w-6 text-primary" />
            Send Money
          </SheetTitle>
          <SheetDescription>
            Send money to another Doings user by username — no platform or transaction fees.
          </SheetDescription>
        </SheetHeader>

        <div className="min-h-0 flex-1 overflow-y-auto overscroll-y-contain pb-6 [-webkit-overflow-scrolling:touch]">
          <AnimatePresence mode="sync">
            {step === "recipient" && (
              <motion.div
                key="recipient"
                initial={{ opacity: 0, x: 20 }}
                animate={{ opacity: 1, x: 0 }}
                exit={{ opacity: 0, x: -20 }}
                className="space-y-6"
              >
                <div className="space-y-2">
                  <Label>Find by username</Label>
                  <div className="flex gap-2">
                    <div className="relative flex-1">
                      <AtSign className="absolute left-3 top-1/2 -translate-y-1/2 w-4 h-4 text-muted-foreground" />
                      <Input
                        placeholder="username"
                        value={searchQuery}
                        onChange={(e) => setSearchQuery(normalizeUsernameInput(e.target.value))}
                        onKeyDown={(e) => {
                          if (e.key === "Enter") void handleSearch();
                        }}
                        className="pl-10"
                        autoCapitalize="off"
                        autoCorrect="off"
                        spellCheck={false}
                      />
                    </div>
                    <Button onClick={() => void handleSearch()} disabled={searching || normalizedSearch.length < 3}>
                      {searching ? <Loader2 className="w-4 h-4 animate-spin" /> : <Search className="w-4 h-4" />}
                    </Button>
                  </div>
                  <p className="text-xs text-muted-foreground">
                    Letters, numbers, and underscores only. No phone or email lookup yet.
                  </p>
                </div>

                {selectedRecipient && (
                  <motion.div
                    initial={{ opacity: 0, y: 10 }}
                    animate={{ opacity: 1, y: 0 }}
                    className="p-4 rounded-2xl bg-primary/10 border-2 border-primary"
                  >
                    <div className="flex items-center gap-3">
                      <div className="w-14 h-14 rounded-full bg-card flex items-center justify-center text-2xl">
                        {selectedRecipient.avatar}
                      </div>
                      <div className="flex-1">
                        <p className="font-bold">{selectedRecipient.name}</p>
                        <p className="text-sm text-muted-foreground">{selectedRecipient.username}</p>
                      </div>
                      <Check className="w-6 h-6 text-primary" />
                    </div>
                  </motion.div>
                )}

                {!selectedRecipient && (
                  <div className="space-y-3">
                    <p className="text-sm font-medium text-muted-foreground">Recent</p>
                    {recentLoading ? (
                      <div className="flex items-center justify-center py-8 text-muted-foreground">
                        <Loader2 className="w-5 h-5 animate-spin mr-2" />
                        Loading…
                      </div>
                    ) : recentRecipients.length === 0 ? (
                      <p className="text-sm text-muted-foreground py-4 text-center">
                        No recent recipients yet
                      </p>
                    ) : (
                      <div className="space-y-2">
                        {recentRecipients.map((recipient) => (
                          <button
                            key={recipient.id}
                            type="button"
                            onClick={() => setSelectedRecipient(recipient)}
                            className="w-full p-3 rounded-xl bg-card border border-border hover:border-primary/50 transition-colors flex items-center gap-3"
                          >
                            <div className="w-12 h-12 rounded-full bg-muted flex items-center justify-center text-xl">
                              {recipient.avatar}
                            </div>
                            <div className="text-left">
                              <p className="font-medium">{recipient.name}</p>
                              <p className="text-sm text-muted-foreground">{recipient.username}</p>
                            </div>
                          </button>
                        ))}
                      </div>
                    )}
                  </div>
                )}

                <Button
                  className="w-full"
                  size="lg"
                  disabled={!selectedRecipient}
                  onClick={() => setStep("amount")}
                >
                  Continue
                  <ArrowRight className="w-5 h-5 ml-2" />
                </Button>
              </motion.div>
            )}

            {step === "amount" && (
              <motion.div
                key="amount"
                initial={{ opacity: 0, x: 20 }}
                animate={{ opacity: 1, x: 0 }}
                exit={{ opacity: 0, x: -20 }}
                className="space-y-6"
              >
                <div className="p-4 rounded-2xl bg-card border border-border flex items-center gap-3">
                  <div className="w-12 h-12 rounded-full bg-muted flex items-center justify-center text-xl">
                    {selectedRecipient?.avatar}
                  </div>
                  <div className="flex-1">
                    <p className="text-sm text-muted-foreground">Sending to</p>
                    <p className="font-bold">{selectedRecipient?.name}</p>
                    <p className="text-xs text-muted-foreground">{selectedRecipient?.username}</p>
                  </div>
                  <Button variant="ghost" size="sm" onClick={() => setStep("recipient")}>
                    Change
                  </Button>
                </div>

                <div className="text-center">
                  <p className="text-sm text-muted-foreground">Available Balance</p>
                  <p className="text-2xl font-bold">₦{balance.toLocaleString()}</p>
                </div>

                <div className="space-y-2">
                  <Label>Amount</Label>
                  <div className="relative">
                    <span className="absolute left-4 top-1/2 -translate-y-1/2 text-xl font-bold text-muted-foreground">
                      ₦
                    </span>
                    <Input
                      type="text"
                      inputMode="numeric"
                      placeholder="0"
                      value={amount ? parseInt(amount, 10).toLocaleString() : ""}
                      onChange={(e) => handleAmountChange(e.target.value.replace(/,/g, ""))}
                      className="pl-10 text-2xl font-bold h-16 text-center"
                    />
                  </div>
                </div>

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

                <div className="space-y-2">
                  <Label>Add a note (optional)</Label>
                  <Input
                    placeholder="What's this for?"
                    value={note}
                    onChange={(e) => setNote(e.target.value)}
                    maxLength={100}
                  />
                </div>

                {numericAmount > 0 && numericAmount < 100 && (
                  <p className="text-sm text-destructive flex items-center gap-2">
                    <AlertCircle className="w-4 h-4" />
                    Minimum amount is ₦100
                  </p>
                )}
                {numericAmount > balance && (
                  <p className="text-sm text-destructive flex items-center gap-2">
                    <AlertCircle className="w-4 h-4" />
                    Insufficient balance
                  </p>
                )}

                <div className="flex gap-3">
                  <Button variant="outline" className="flex-1" onClick={() => setStep("recipient")}>
                    Back
                  </Button>
                  <Button className="flex-1" disabled={!canSend} onClick={() => setStep("confirm")}>
                    Continue
                  </Button>
                </div>
              </motion.div>
            )}

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
                    <div className="text-4xl">{selectedRecipient?.avatar}</div>
                  </div>
                  <p className="text-muted-foreground">
                    Sending to {selectedRecipient?.name} ({selectedRecipient?.username})
                  </p>
                  <p className="text-4xl font-black">₦{numericAmount.toLocaleString()}</p>
                  {P2P_TRANSFER_FEE_NAIRA === 0 && (
                    <p className="text-sm text-green-600 dark:text-green-400 mt-2 font-medium">
                      No fees — recipient gets the full amount
                    </p>
                  )}
                  {note && <p className="text-sm text-muted-foreground mt-2">&ldquo;{note}&rdquo;</p>}
                </div>

                <PinInput value={pin} onChange={setPin} label="Enter transaction PIN to confirm" />

                <div className="flex gap-3">
                  <Button variant="outline" className="flex-1" onClick={() => setStep("amount")}>
                    Back
                  </Button>
                  <Button className="flex-1" onClick={() => void handleConfirm()} disabled={!isValidPin(pin)}>
                    Send Money
                  </Button>
                </div>
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
                <p className="text-xl font-bold">Sending Money...</p>
                <p className="text-muted-foreground">Please wait</p>
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
                  className="w-24 h-24 rounded-full bg-green-500/20 flex items-center justify-center mb-4"
                >
                  <Check className="w-12 h-12 text-green-500" />
                </motion.div>
                <h3 className="text-2xl font-bold mb-2">Money Sent!</h3>
                <p className="text-4xl font-black mb-2">₦{numericAmount.toLocaleString()}</p>
                <p className="text-muted-foreground mb-6">
                  Successfully sent to {selectedRecipient?.username}
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
