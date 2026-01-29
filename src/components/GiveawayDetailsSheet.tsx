import { motion } from "framer-motion";
import { Sheet, SheetContent, SheetHeader, SheetTitle } from "@/components/ui/sheet";
import { Button } from "@/components/ui/button";
import { Gift, Users, Copy, Share2, StopCircle, Clock, CheckCircle, XCircle, QrCode } from "lucide-react";
import { Giveaway } from "@/hooks/useGiveaways";
import QRCode from "react-qr-code";
import { toast } from "sonner";

interface GiveawayDetailsSheetProps {
  giveaway: Giveaway | null;
  isOpen: boolean;
  onClose: () => void;
  onStop: (giveawayId: string) => void;
}

export const GiveawayDetailsSheet = ({
  giveaway,
  isOpen,
  onClose,
  onStop,
}: GiveawayDetailsSheetProps) => {
  if (!giveaway) return null;

  const redeemLink = `https://doings.app/redeem/${giveaway.code}`;
  const percentUsed = ((giveaway.totalAmount - giveaway.remainingAmount) / giveaway.totalAmount) * 100;
  const winnersCount = giveaway.redemptions.length;
  const maxWinners = Math.floor(giveaway.totalAmount / giveaway.perPersonAmount);

  const handleCopyCode = () => {
    navigator.clipboard.writeText(giveaway.code);
    toast.success("Code copied!");
  };

  const handleCopyLink = () => {
    navigator.clipboard.writeText(redeemLink);
    toast.success("Link copied!");
  };

  const handleShare = async () => {
    if (navigator.share) {
      try {
        await navigator.share({
          title: giveaway.title,
          text: `Join my giveaway! Use code: ${giveaway.code} to win ₦${giveaway.perPersonAmount.toLocaleString()}`,
          url: redeemLink,
        });
      } catch (err) {
        handleCopyLink();
      }
    } else {
      handleCopyLink();
    }
  };

  const handleStop = () => {
    onStop(giveaway.id);
    onClose();
  };

  const getStatusBadge = () => {
    switch (giveaway.status) {
      case 'active':
        return (
          <span className="inline-flex items-center gap-1 px-3 py-1 rounded-full bg-green-500/20 text-green-400 text-xs font-semibold">
            <span className="w-2 h-2 bg-green-500 rounded-full animate-pulse" />
            Active
          </span>
        );
      case 'stopped':
        return (
          <span className="inline-flex items-center gap-1 px-3 py-1 rounded-full bg-red-500/20 text-red-400 text-xs font-semibold">
            <XCircle className="w-3 h-3" />
            Stopped
          </span>
        );
      case 'exhausted':
        return (
          <span className="inline-flex items-center gap-1 px-3 py-1 rounded-full bg-muted text-muted-foreground text-xs font-semibold">
            <CheckCircle className="w-3 h-3" />
            Completed
          </span>
        );
    }
  };

  return (
    <Sheet open={isOpen} onOpenChange={onClose}>
      <SheetContent side="bottom" className="h-[90vh] rounded-t-3xl bg-background overflow-y-auto">
        <SheetHeader className="sr-only">
          <SheetTitle>Giveaway Details</SheetTitle>
        </SheetHeader>
        <div className="h-1 w-12 bg-muted rounded-full mx-auto mb-6" />

        <div className="space-y-6">
          {/* Header */}
          <div className="text-center">
            <motion.div
              initial={{ scale: 0 }}
              animate={{ scale: 1 }}
              className="w-20 h-20 rounded-full bg-gradient-to-br from-primary to-accent flex items-center justify-center mx-auto mb-4"
            >
              <Gift className="w-10 h-10 text-primary-foreground" />
            </motion.div>
            <h2 className="text-xl font-bold text-foreground">{giveaway.title}</h2>
            <div className="flex items-center justify-center gap-2 mt-2">
              {getStatusBadge()}
              <span className="text-xs text-muted-foreground capitalize">
                {giveaway.type} Giveaway
              </span>
            </div>
          </div>

          {/* QR Code */}
          {giveaway.status === 'active' && (
            <div className="flex flex-col items-center p-6 rounded-2xl bg-white">
              <QRCode value={redeemLink} size={180} />
              <p className="text-black text-sm mt-3 font-medium">Scan to redeem</p>
            </div>
          )}

          {/* Code Display */}
          <div className="p-4 rounded-2xl bg-gradient-to-br from-primary/20 to-accent/20 border border-primary/30">
            <p className="text-sm text-muted-foreground text-center mb-2">Giveaway Code</p>
            <p className="text-3xl font-black text-primary tracking-widest text-center">
              {giveaway.code}
            </p>
          </div>

          {/* Stats */}
          <div className="grid grid-cols-2 gap-3">
            <div className="p-4 rounded-2xl bg-card border border-border">
              <p className="text-xs text-muted-foreground mb-1">Total Amount</p>
              <p className="text-lg font-bold text-foreground">₦{giveaway.totalAmount.toLocaleString()}</p>
            </div>
            <div className="p-4 rounded-2xl bg-card border border-border">
              <p className="text-xs text-muted-foreground mb-1">Per Person</p>
              <p className="text-lg font-bold text-foreground">₦{giveaway.perPersonAmount.toLocaleString()}</p>
            </div>
          </div>

          {/* Progress */}
          <div className="p-4 rounded-2xl bg-card border border-border">
            <div className="flex items-center justify-between mb-2">
              <span className="text-sm text-muted-foreground">Redemptions</span>
              <span className="text-sm font-bold text-foreground">{winnersCount}/{maxWinners}</span>
            </div>
            <div className="h-3 bg-muted rounded-full overflow-hidden">
              <motion.div
                initial={{ width: 0 }}
                animate={{ width: `${percentUsed}%` }}
                className="h-full bg-gradient-to-r from-primary to-accent rounded-full"
              />
            </div>
            <div className="flex items-center justify-between mt-2">
              <span className="text-xs text-muted-foreground">Remaining</span>
              <span className="text-xs font-bold text-primary">₦{giveaway.remainingAmount.toLocaleString()}</span>
            </div>
          </div>

          {/* Recent Redemptions */}
          {giveaway.redemptions.length > 0 && (
            <div className="p-4 rounded-2xl bg-card border border-border">
              <div className="flex items-center gap-2 mb-3">
                <Users className="w-4 h-4 text-muted-foreground" />
                <span className="text-sm font-medium text-foreground">Recent Redemptions</span>
              </div>
              <div className="space-y-2 max-h-32 overflow-y-auto">
                {giveaway.redemptions.slice(-5).reverse().map((redemption) => (
                  <div key={redemption.id} className="flex items-center justify-between text-sm">
                    <span className="text-foreground">{redemption.userName}</span>
                    <span className="text-primary font-medium">+₦{redemption.amount.toLocaleString()}</span>
                  </div>
                ))}
              </div>
            </div>
          )}

          {/* Actions */}
          {giveaway.status === 'active' && (
            <div className="space-y-3">
              <div className="grid grid-cols-3 gap-3">
                <Button
                  variant="outline"
                  onClick={handleCopyCode}
                  className="h-12 rounded-xl flex flex-col items-center gap-1"
                >
                  <Copy className="w-4 h-4" />
                  <span className="text-xs">Copy Code</span>
                </Button>
                <Button
                  variant="outline"
                  onClick={handleCopyLink}
                  className="h-12 rounded-xl flex flex-col items-center gap-1"
                >
                  <QrCode className="w-4 h-4" />
                  <span className="text-xs">Copy Link</span>
                </Button>
                <Button
                  variant="outline"
                  onClick={handleShare}
                  className="h-12 rounded-xl flex flex-col items-center gap-1"
                >
                  <Share2 className="w-4 h-4" />
                  <span className="text-xs">Share</span>
                </Button>
              </div>

              <Button
                onClick={handleStop}
                variant="destructive"
                className="w-full h-14 rounded-2xl font-bold"
              >
                <StopCircle className="w-5 h-5 mr-2" />
                Stop Giveaway
              </Button>
              <p className="text-xs text-center text-muted-foreground">
                Remaining ₦{giveaway.remainingAmount.toLocaleString()} will be refunded to your wallet
              </p>
            </div>
          )}

          {giveaway.status !== 'active' && (
            <Button
              onClick={onClose}
              className="w-full h-14 rounded-2xl bg-primary text-primary-foreground font-bold"
            >
              Close
            </Button>
          )}
        </div>
      </SheetContent>
    </Sheet>
  );
};
