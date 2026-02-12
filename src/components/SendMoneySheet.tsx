import { useState } from "react";
import { motion, AnimatePresence } from "framer-motion";
import { Send, User, Search, Check, ArrowRight, AlertCircle, AtSign, Phone } from "lucide-react";
import { Sheet, SheetContent, SheetHeader, SheetTitle, SheetDescription } from "@/components/ui/sheet";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { useMultiWallet } from "@/hooks/useMultiWallet";
import { toast } from "sonner";

interface SendMoneySheetProps {
  open: boolean;
  onOpenChange: (open: boolean) => void;
}

type SendStep = "recipient" | "amount" | "confirm" | "processing" | "success";

interface Recipient {
  id: string;
  name: string;
  username: string;
  avatar: string;
  phone?: string;
}

const QUICK_AMOUNTS = [1000, 2000, 5000, 10000, 20000];

// Mock recent recipients
const RECENT_RECIPIENTS: Recipient[] = [
  { id: "1", name: "Adebayo Johnson", username: "@adebayo_j", avatar: "🧑🏾" },
  { id: "2", name: "Chidinma Okonkwo", username: "@chi_chi", avatar: "👩🏾" },
  { id: "3", name: "Fatima Ibrahim", username: "@fatima_i", avatar: "👩🏽" },
  { id: "4", name: "Emmanuel Okoro", username: "@emeka_o", avatar: "👨🏾" },
];

export const SendMoneySheet = ({ open, onOpenChange }: SendMoneySheetProps) => {
  const { ngnBalance, debitWallet } = useMultiWallet();
  const balance = ngnBalance;
  const [step, setStep] = useState<SendStep>("recipient");
  const [searchQuery, setSearchQuery] = useState("");
  const [selectedRecipient, setSelectedRecipient] = useState<Recipient | null>(null);
  const [amount, setAmount] = useState("");
  const [note, setNote] = useState("");
  const [pin, setPin] = useState("");

  const numericAmount = parseFloat(amount) || 0;
  const canSend = numericAmount >= 100 && numericAmount <= balance;

  const handleSearch = async () => {
    if (searchQuery.length < 3) return;

    // Simulate search
    toast.loading("Searching...", { id: "search" });
    await new Promise((resolve) => setTimeout(resolve, 1000));
    
    // Mock found user
    const foundUser: Recipient = {
      id: "found-1",
      name: searchQuery.includes("@") ? "Found User" : "New User",
      username: searchQuery.startsWith("@") ? searchQuery : `@${searchQuery.toLowerCase().replace(/\s/g, "_")}`,
      avatar: "👤",
    };
    
    toast.success("User found!", { id: "search" });
    setSelectedRecipient(foundUser);
  };

  const handleAmountChange = (value: string) => {
    const cleaned = value.replace(/[^0-9]/g, "");
    setAmount(cleaned);
  };

  const handleConfirm = async () => {
    if (pin.length !== 4) {
      toast.error("Please enter your 4-digit PIN");
      return;
    }

    setStep("processing");

    try {
      await new Promise((resolve) => setTimeout(resolve, 2000));
      
      debitWallet("NGN", numericAmount, `Sent to ${selectedRecipient?.name}`, "send");
      
      setStep("success");
    } catch (error) {
      toast.error("Transfer failed. Please try again.");
      setStep("amount");
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
      <SheetContent side="bottom" className="h-[90vh] rounded-t-3xl bg-background">
        <SheetHeader className="text-left pb-4">
          <SheetTitle className="text-2xl font-bold flex items-center gap-2">
            <Send className="w-6 h-6 text-primary" />
            Send Money
          </SheetTitle>
          <SheetDescription>
            Send money to friends and family instantly
          </SheetDescription>
        </SheetHeader>

        <div className="overflow-y-auto max-h-[70vh] pb-6">
          <AnimatePresence mode="wait">
            {/* Recipient Step */}
            {step === "recipient" && (
              <motion.div
                key="recipient"
                initial={{ opacity: 0, x: 20 }}
                animate={{ opacity: 1, x: 0 }}
                exit={{ opacity: 0, x: -20 }}
                className="space-y-6"
              >
                {/* Search Input */}
                <div className="space-y-2">
                  <Label>Find Recipient</Label>
                  <div className="flex gap-2">
                    <div className="relative flex-1">
                      <Search className="absolute left-3 top-1/2 -translate-y-1/2 w-4 h-4 text-muted-foreground" />
                      <Input
                        placeholder="Username, phone, or email"
                        value={searchQuery}
                        onChange={(e) => setSearchQuery(e.target.value)}
                        className="pl-10"
                      />
                    </div>
                    <Button onClick={handleSearch} disabled={searchQuery.length < 3}>
                      Search
                    </Button>
                  </div>
                </div>

                {/* Selected Recipient */}
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

                {/* Quick Select Buttons */}
                <div className="flex gap-2">
                  <Button
                    variant="outline"
                    size="sm"
                    className="flex-1"
                    onClick={() => setSearchQuery("@")}
                  >
                    <AtSign className="w-4 h-4 mr-1" />
                    Username
                  </Button>
                  <Button
                    variant="outline"
                    size="sm"
                    className="flex-1"
                    onClick={() => setSearchQuery("+234")}
                  >
                    <Phone className="w-4 h-4 mr-1" />
                    Phone
                  </Button>
                </div>

                {/* Recent Recipients */}
                {!selectedRecipient && (
                  <div className="space-y-3">
                    <p className="text-sm font-medium text-muted-foreground">Recent</p>
                    <div className="space-y-2">
                      {RECENT_RECIPIENTS.map((recipient) => (
                        <button
                          key={recipient.id}
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

            {/* Amount Step */}
            {step === "amount" && (
              <motion.div
                key="amount"
                initial={{ opacity: 0, x: 20 }}
                animate={{ opacity: 1, x: 0 }}
                exit={{ opacity: 0, x: -20 }}
                className="space-y-6"
              >
                {/* Recipient Card */}
                <div className="p-4 rounded-2xl bg-card border border-border flex items-center gap-3">
                  <div className="w-12 h-12 rounded-full bg-muted flex items-center justify-center text-xl">
                    {selectedRecipient?.avatar}
                  </div>
                  <div className="flex-1">
                    <p className="text-sm text-muted-foreground">Sending to</p>
                    <p className="font-bold">{selectedRecipient?.name}</p>
                  </div>
                  <Button variant="ghost" size="sm" onClick={() => setStep("recipient")}>
                    Change
                  </Button>
                </div>

                {/* Balance Display */}
                <div className="text-center">
                  <p className="text-sm text-muted-foreground">Available Balance</p>
                  <p className="text-2xl font-bold">₦{balance.toLocaleString()}</p>
                </div>

                {/* Amount Input */}
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

                {/* Note */}
                <div className="space-y-2">
                  <Label>Add a note (optional)</Label>
                  <Input
                    placeholder="What's this for?"
                    value={note}
                    onChange={(e) => setNote(e.target.value)}
                    maxLength={100}
                  />
                </div>

                {/* Validation */}
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
                    <div className="text-4xl">{selectedRecipient?.avatar}</div>
                  </div>
                  <p className="text-muted-foreground">Sending to {selectedRecipient?.name}</p>
                  <p className="text-4xl font-black">₦{numericAmount.toLocaleString()}</p>
                  {note && (
                    <p className="text-sm text-muted-foreground mt-2">"{note}"</p>
                  )}
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
                    Send Money
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
                <p className="text-xl font-bold">Sending Money...</p>
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
                <h3 className="text-2xl font-bold mb-2">Money Sent! 🎉</h3>
                <p className="text-4xl font-black mb-2">₦{numericAmount.toLocaleString()}</p>
                <p className="text-muted-foreground mb-6">
                  Successfully sent to {selectedRecipient?.name}
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
