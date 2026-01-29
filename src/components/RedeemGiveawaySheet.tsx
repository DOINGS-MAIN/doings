import { useState } from "react";
import { motion, AnimatePresence } from "framer-motion";
import { Sheet, SheetContent, SheetHeader, SheetTitle } from "@/components/ui/sheet";
import { Input } from "@/components/ui/input";
import { Button } from "@/components/ui/button";
import { Gift, QrCode, Keyboard, CheckCircle, XCircle, Sparkles } from "lucide-react";
import { Giveaway } from "@/hooks/useGiveaways";

interface RedeemGiveawaySheetProps {
  isOpen: boolean;
  onClose: () => void;
  onRedeem: (code: string) => { success: boolean; message: string; amount?: number };
  findGiveawayByCode: (code: string) => Giveaway | undefined;
}

export const RedeemGiveawaySheet = ({
  isOpen,
  onClose,
  onRedeem,
  findGiveawayByCode,
}: RedeemGiveawaySheetProps) => {
  const [code, setCode] = useState("");
  const [mode, setMode] = useState<'input' | 'result'>('input');
  const [result, setResult] = useState<{ success: boolean; message: string; amount?: number } | null>(null);
  const [previewGiveaway, setPreviewGiveaway] = useState<Giveaway | null>(null);

  const handleCodeChange = (value: string) => {
    const upperCode = value.toUpperCase().replace(/[^A-Z0-9]/g, '').slice(0, 6);
    setCode(upperCode);
    
    if (upperCode.length === 6) {
      const giveaway = findGiveawayByCode(upperCode);
      setPreviewGiveaway(giveaway || null);
    } else {
      setPreviewGiveaway(null);
    }
  };

  const handleRedeem = () => {
    const redeemResult = onRedeem(code);
    setResult(redeemResult);
    setMode('result');
  };

  const handleClose = () => {
    setCode("");
    setMode('input');
    setResult(null);
    setPreviewGiveaway(null);
    onClose();
  };

  const handleTryAgain = () => {
    setCode("");
    setMode('input');
    setResult(null);
    setPreviewGiveaway(null);
  };

  return (
    <Sheet open={isOpen} onOpenChange={handleClose}>
      <SheetContent side="bottom" className="h-[70vh] rounded-t-3xl bg-background">
        <SheetHeader className="sr-only">
          <SheetTitle>Redeem Giveaway</SheetTitle>
        </SheetHeader>
        <div className="h-1 w-12 bg-muted rounded-full mx-auto mb-6" />

        <AnimatePresence mode="wait">
          {mode === 'input' && (
            <motion.div
              key="input"
              initial={{ opacity: 0, y: 20 }}
              animate={{ opacity: 1, y: 0 }}
              exit={{ opacity: 0, y: -20 }}
              className="space-y-6"
            >
              <div className="text-center">
                <motion.div
                  initial={{ scale: 0 }}
                  animate={{ scale: 1 }}
                  className="w-20 h-20 rounded-full bg-gradient-to-br from-primary to-accent flex items-center justify-center mx-auto mb-4"
                >
                  <Gift className="w-10 h-10 text-primary-foreground" />
                </motion.div>
                <h2 className="text-xl font-bold text-foreground">Redeem Giveaway</h2>
                <p className="text-sm text-muted-foreground mt-1">Enter the 6-digit code to claim your reward</p>
              </div>

              {/* Code Input */}
              <div className="space-y-2">
                <div className="relative">
                  <Keyboard className="absolute left-4 top-1/2 -translate-y-1/2 w-5 h-5 text-muted-foreground" />
                  <Input
                    placeholder="XXXXXX"
                    value={code}
                    onChange={(e) => handleCodeChange(e.target.value)}
                    className="text-center text-2xl font-black tracking-[0.3em] h-16 pl-12"
                    maxLength={6}
                  />
                </div>
                <p className="text-xs text-muted-foreground text-center">
                  Code is case-insensitive
                </p>
              </div>

              {/* Preview */}
              {previewGiveaway && (
                <motion.div
                  initial={{ opacity: 0, scale: 0.95 }}
                  animate={{ opacity: 1, scale: 1 }}
                  className="p-4 rounded-2xl bg-gradient-to-br from-primary/20 to-accent/20 border border-primary/30"
                >
                  <div className="flex items-center gap-3 mb-3">
                    <div className="w-12 h-12 rounded-full bg-primary/20 flex items-center justify-center">
                      <Gift className="w-6 h-6 text-primary" />
                    </div>
                    <div className="flex-1">
                      <p className="font-bold text-foreground">{previewGiveaway.title}</p>
                      <p className="text-sm text-muted-foreground">by {previewGiveaway.creatorName}</p>
                    </div>
                    {previewGiveaway.status === 'active' && (
                      <span className="px-2 py-1 rounded-full bg-green-500/20 text-green-400 text-xs font-semibold">
                        Active
                      </span>
                    )}
                  </div>
                  <div className="flex items-center justify-between text-sm">
                    <span className="text-muted-foreground">You'll receive</span>
                    <span className="text-lg font-bold text-primary">
                      ₦{previewGiveaway.perPersonAmount.toLocaleString()}
                    </span>
                  </div>
                </motion.div>
              )}

              {/* QR Option */}
              <div className="flex items-center gap-4">
                <div className="flex-1 h-px bg-border" />
                <span className="text-xs text-muted-foreground">or</span>
                <div className="flex-1 h-px bg-border" />
              </div>

              <Button
                variant="outline"
                className="w-full h-14 rounded-2xl"
                onClick={() => {
                  // QR scanning would be implemented here
                  // For now, show a message
                }}
              >
                <QrCode className="w-5 h-5 mr-2" />
                Scan QR Code
              </Button>

              <Button
                onClick={handleRedeem}
                disabled={code.length !== 6}
                className="w-full h-14 rounded-2xl bg-gradient-to-r from-primary to-accent text-primary-foreground font-bold text-lg"
              >
                Redeem Now
              </Button>
            </motion.div>
          )}

          {mode === 'result' && result && (
            <motion.div
              key="result"
              initial={{ opacity: 0, scale: 0.9 }}
              animate={{ opacity: 1, scale: 1 }}
              className="text-center space-y-6"
            >
              <motion.div
                initial={{ scale: 0 }}
                animate={{ scale: 1 }}
                transition={{ type: "spring", delay: 0.2 }}
                className={`w-24 h-24 rounded-full flex items-center justify-center mx-auto ${
                  result.success 
                    ? 'bg-gradient-to-br from-green-500 to-emerald-600' 
                    : 'bg-gradient-to-br from-red-500 to-rose-600'
                }`}
              >
                {result.success ? (
                  <CheckCircle className="w-12 h-12 text-white" />
                ) : (
                  <XCircle className="w-12 h-12 text-white" />
                )}
              </motion.div>

              <div>
                <h3 className="text-2xl font-bold text-foreground mb-2">
                  {result.success ? 'Congratulations! 🎉' : 'Oops!'}
                </h3>
                <p className="text-muted-foreground">{result.message}</p>
              </div>

              {result.success && result.amount && (
                <motion.div
                  initial={{ opacity: 0, y: 20 }}
                  animate={{ opacity: 1, y: 0 }}
                  transition={{ delay: 0.3 }}
                  className="p-6 rounded-2xl bg-gradient-to-br from-primary/20 to-accent/20 border border-primary/30"
                >
                  <Sparkles className="w-8 h-8 text-primary mx-auto mb-2" />
                  <p className="text-sm text-muted-foreground">Amount received</p>
                  <p className="text-4xl font-black text-primary">
                    ₦{result.amount.toLocaleString()}
                  </p>
                </motion.div>
              )}

              {result.success ? (
                <Button
                  onClick={handleClose}
                  className="w-full h-14 rounded-2xl bg-primary text-primary-foreground font-bold"
                >
                  Done
                </Button>
              ) : (
                <div className="space-y-3">
                  <Button
                    onClick={handleTryAgain}
                    className="w-full h-14 rounded-2xl bg-primary text-primary-foreground font-bold"
                  >
                    Try Again
                  </Button>
                  <Button
                    variant="ghost"
                    onClick={handleClose}
                    className="w-full"
                  >
                    Cancel
                  </Button>
                </div>
              )}
            </motion.div>
          )}
        </AnimatePresence>
      </SheetContent>
    </Sheet>
  );
};
