import { useEffect, useState, useCallback } from "react";
import { motion } from "framer-motion";
import { ArrowLeftRight, Shield, Loader2, RefreshCw } from "lucide-react";
import { Sheet, SheetContent, SheetHeader, SheetTitle, SheetDescription } from "@/components/ui/sheet";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { PinInput } from "@/components/PinInput";
import { toast } from "sonner";
import { fx as fxApi } from "@/lib/supabase";
import { useFxQuote } from "@/hooks/useFxQuote";
import { isValidPin } from "@/lib/pin";
import { Currency, KYCLevel, KYC_GATES } from "@/types/finance";

interface ConvertSheetProps {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  onOpenKYC: () => void;
  onPinNotSet?: () => void;
  kycLevel: KYCLevel;
  ngnBalance: number;
  usdcBalance: number;
  onSuccess?: () => void;
}

const USDC_QUICK = [5, 10, 25, 50, 100];

export const ConvertSheet = ({
  open,
  onOpenChange,
  onOpenKYC,
  onPinNotSet,
  kycLevel,
  ngnBalance,
  usdcBalance,
  onSuccess,
}: ConvertSheetProps) => {
  const [side, setSide] = useState<"sell" | "buy">("sell");
  const [amount, setAmount] = useState("");
  const [pin, setPin] = useState("");
  const [step, setStep] = useState<"amount" | "confirm" | "processing">("amount");
  const [converting, setConverting] = useState(false);

  const {
    settings,
    quote,
    secondsLeft,
    loading: quoteLoading,
    error: quoteError,
    fetchSettings,
    requestQuote,
    reset,
  } = useFxQuote();

  const numericAmount = parseFloat(amount) || 0;
  const minTrade = settings?.min_trade_usdc ?? 5;

  const resetSheet = useCallback(() => {
    setAmount("");
    setPin("");
    setStep("amount");
    reset();
  }, [reset]);

  useEffect(() => {
    if (open) {
      void fetchSettings();
    } else {
      resetSheet();
    }
  }, [open, fetchSettings, resetSheet]);

  const debouncedQuote = useCallback(() => {
    if (!open || numericAmount < minTrade) return;
    if (side === "sell" && numericAmount > usdcBalance) return;
    void requestQuote(side, numericAmount).catch(() => {});
  }, [open, numericAmount, minTrade, side, usdcBalance, requestQuote]);

  useEffect(() => {
    const t = setTimeout(debouncedQuote, 400);
    return () => clearTimeout(t);
  }, [debouncedQuote, side, amount]);

  const handleSideChange = (next: "sell" | "buy") => {
    setSide(next);
    reset();
    setStep("amount");
  };

  const handleConvert = async () => {
    if (!quote || !isValidPin(pin)) return;
    setConverting(true);
    setStep("processing");
    try {
      await fxApi.convert(quote.quote_id, pin);
      toast.success(
        side === "sell"
          ? `Sold ${quote.usdc} USDC — ₦${quote.ngn_net.toLocaleString()} credited`
          : `Bought ${quote.usdc} USDC for ₦${quote.ngn_net.toLocaleString()}`
      );
      onSuccess?.();
      onOpenChange(false);
      resetSheet();
    } catch (err) {
      const code = (err as Error & { code?: string }).code;
      if (code === "PIN_NOT_SET") {
        onPinNotSet?.();
        setStep("confirm");
        return;
      }
      if (code === "QUOTE_EXPIRED") {
        toast.error("Rate expired — refreshing quote");
        setStep("amount");
        void requestQuote(side, numericAmount);
      } else {
        toast.error(err instanceof Error ? err.message : "Conversion failed");
        setStep("confirm");
      }
    } finally {
      setConverting(false);
    }
  };

  if (kycLevel < KYC_GATES.CONVERT) {
    return (
      <Sheet open={open} onOpenChange={onOpenChange}>
        <SheetContent side="bottom" className="h-[50dvh] max-h-[50dvh] rounded-t-3xl bg-background">
          <div className="flex h-full flex-col items-center justify-center px-6 text-center">
            <div className="w-20 h-20 rounded-full bg-primary/10 flex items-center justify-center mb-4">
              <Shield className="w-10 h-10 text-primary" />
            </div>
            <h2 className="text-xl font-bold mb-2">Complete Full Verification</h2>
            <p className="text-muted-foreground mb-6">
              Complete BVN + NIN verification (Level 2) to convert between USDC and NGN.
            </p>
            <Button onClick={() => { onOpenChange(false); onOpenKYC(); }}>
              Complete Verification
            </Button>
          </div>
        </SheetContent>
      </Sheet>
    );
  }

  if (settings && !settings.enabled) {
    return (
      <Sheet open={open} onOpenChange={onOpenChange}>
        <SheetContent side="bottom" className="h-[40dvh] rounded-t-3xl bg-background">
          <div className="flex h-full flex-col items-center justify-center px-6 text-center">
            <p className="text-muted-foreground">Currency conversion is temporarily unavailable.</p>
          </div>
        </SheetContent>
      </Sheet>
    );
  }

  return (
    <Sheet open={open} onOpenChange={onOpenChange}>
      <SheetContent side="bottom" className="h-[85dvh] max-h-[85dvh] rounded-t-3xl bg-background overflow-y-auto">
        <SheetHeader className="text-left pb-4">
          <SheetTitle className="flex items-center gap-2">
            <ArrowLeftRight className="w-5 h-5" />
            Convert
          </SheetTitle>
          <SheetDescription>
            {side === "sell" ? "Sell USDC and receive NGN" : "Buy USDC with your NGN balance"}
          </SheetDescription>
        </SheetHeader>

        <div className="flex gap-2 mb-6">
          {(["sell", "buy"] as const).map((s) => (
            <button
              key={s}
              type="button"
              onClick={() => handleSideChange(s)}
              className={`flex-1 py-2.5 rounded-xl text-sm font-bold transition-all ${
                side === s
                  ? "bg-primary text-primary-foreground"
                  : "bg-muted text-muted-foreground"
              }`}
            >
              {s === "sell" ? "Sell USDC" : "Buy USDC"}
            </button>
          ))}
        </div>

        {step === "amount" && (
          <div className="space-y-4">
            <div>
              <Label>Amount (USDC)</Label>
              <Input
                type="text"
                inputMode="decimal"
                placeholder="0.00"
                value={amount}
                onChange={(e) => setAmount(e.target.value.replace(/[^0-9.]/g, ""))}
                className="text-2xl font-bold h-14 mt-1"
              />
              <p className="text-xs text-muted-foreground mt-1">
                Min {minTrade} USDC · Balance:{" "}
                {side === "sell" ? `$${usdcBalance.toFixed(2)}` : `₦${ngnBalance.toLocaleString()}`}
              </p>
            </div>

            <div className="flex flex-wrap gap-2">
              {USDC_QUICK.map((v) => (
                <button
                  key={v}
                  type="button"
                  onClick={() => setAmount(String(v))}
                  className="px-3 py-1.5 rounded-full bg-muted text-sm font-medium"
                >
                  {v} USDC
                </button>
              ))}
              {side === "sell" && (
                <button
                  type="button"
                  onClick={() => setAmount(String(Math.floor(usdcBalance * 100) / 100))}
                  className="px-3 py-1.5 rounded-full bg-primary/10 text-primary text-sm font-medium"
                >
                  Max
                </button>
              )}
            </div>

            <motion.div
              className="rounded-2xl border border-border bg-card p-4 space-y-3"
              layout
            >
              <div className="flex items-center justify-between text-sm">
                <span className="text-muted-foreground">Rate</span>
                {quoteLoading ? (
                  <Loader2 className="w-4 h-4 animate-spin" />
                ) : quote ? (
                  <span className="font-semibold">₦{quote.effective_rate_naira.toLocaleString()} / USDC</span>
                ) : settings?.sell_rate_naira ? (
                  <span className="text-muted-foreground">
                    ₦{(side === "sell" ? settings.sell_rate_naira : settings.buy_rate_naira)?.toLocaleString()} / USDC
                  </span>
                ) : (
                  <span className="text-muted-foreground">—</span>
                )}
              </div>

              {quote && (
                <>
                  <div className="flex items-center justify-between text-sm">
                    <span className="text-muted-foreground">
                      {side === "sell" ? "You receive" : "You pay"}
                    </span>
                    <span className="font-bold text-lg">
                      {side === "sell"
                        ? `₦${quote.ngn_net.toLocaleString()}`
                        : `₦${quote.ngn_net.toLocaleString()}`}
                    </span>
                  </div>
                  {quote.fee_naira > 0 && (
                    <div className="flex items-center justify-between text-xs text-muted-foreground">
                      <span>Platform fee</span>
                      <span>₦{quote.fee_naira.toLocaleString()}</span>
                    </div>
                  )}
                  <div className="flex items-center justify-between pt-2 border-t border-border">
                    <span className="text-xs text-muted-foreground flex items-center gap-1">
                      <RefreshCw className={`w-3 h-3 ${secondsLeft <= 5 ? "animate-spin" : ""}`} />
                      Rate locks in
                    </span>
                    <span
                      className={`text-sm font-mono font-bold ${
                        secondsLeft <= 10 ? "text-amber-500" : "text-foreground"
                      }`}
                    >
                      {secondsLeft}s
                    </span>
                  </div>
                </>
              )}

              {quoteError && (
                <p className="text-sm text-destructive">{quoteError}</p>
              )}
            </motion.div>

            <Button
              className="w-full h-12"
              disabled={!quote || quoteLoading || numericAmount < minTrade || secondsLeft <= 0}
              onClick={() => setStep("confirm")}
            >
              Continue
            </Button>
          </div>
        )}

        {step === "confirm" && quote && (
          <div className="space-y-6">
            <div className="rounded-2xl bg-muted/50 p-4 space-y-2 text-sm">
              <div className="flex justify-between">
                <span className="text-muted-foreground">Direction</span>
                <span className="font-medium">{side === "sell" ? "Sell USDC → NGN" : "Buy USDC ← NGN"}</span>
              </div>
              <div className="flex justify-between">
                <span className="text-muted-foreground">USDC</span>
                <span className="font-medium">{quote.usdc} USDC</span>
              </div>
              <div className="flex justify-between">
                <span className="text-muted-foreground">Rate</span>
                <span>₦{quote.effective_rate_naira.toLocaleString()}</span>
              </div>
              <div className="flex justify-between font-bold">
                <span>{side === "sell" ? "You receive" : "Total debit"}</span>
                <span>₦{quote.ngn_net.toLocaleString()}</span>
              </div>
              <div className="flex justify-between text-xs text-amber-600">
                <span>Quote expires in</span>
                <span>{secondsLeft}s</span>
              </div>
            </div>

            <div>
              <Label>Transaction PIN</Label>
              <PinInput value={pin} onChange={setPin} className="mt-2" />
            </div>

            <div className="flex gap-3">
              <Button variant="outline" className="flex-1" onClick={() => setStep("amount")}>
                Back
              </Button>
              <Button
                className="flex-1"
                disabled={!isValidPin(pin) || secondsLeft <= 0 || converting}
                onClick={() => void handleConvert()}
              >
                {side === "sell" ? "Sell USDC" : "Buy USDC"}
              </Button>
            </div>
          </div>
        )}

        {step === "processing" && (
          <div className="flex flex-col items-center justify-center py-12">
            <Loader2 className="w-10 h-10 animate-spin text-primary mb-4" />
            <p className="text-muted-foreground">Processing conversion…</p>
          </div>
        )}
      </SheetContent>
    </Sheet>
  );
};
