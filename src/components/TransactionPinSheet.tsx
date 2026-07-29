import { useEffect, useState } from "react";
import { Lock, Loader2 } from "lucide-react";
import { Sheet, SheetContent, SheetHeader, SheetTitle, SheetDescription } from "@/components/ui/sheet";
import { Button } from "@/components/ui/button";
import { PinInput } from "@/components/PinInput";
import { isValidPin, rpcErrorMessage } from "@/lib/pin";
import { toast } from "sonner";

interface TransactionPinSheetProps {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  hasPin: boolean | null;
  loading: boolean;
  setPin: (pin: string, currentPin?: string) => Promise<void>;
  refreshPin: () => Promise<void>;
}

export const TransactionPinSheet = ({
  open,
  onOpenChange,
  hasPin,
  loading,
  setPin,
  refreshPin,
}: TransactionPinSheetProps) => {
  const [currentPin, setCurrentPin] = useState("");
  const [newPin, setNewPin] = useState("");
  const [confirmPin, setConfirmPin] = useState("");
  const [saving, setSaving] = useState(false);

  useEffect(() => {
    if (open) {
      void refreshPin();
      setCurrentPin("");
      setNewPin("");
      setConfirmPin("");
    }
  }, [open, refreshPin]);

  const handleSave = async () => {
    if (!isValidPin(newPin)) {
      toast.error("PIN must be exactly 4 digits");
      return;
    }
    if (newPin !== confirmPin) {
      toast.error("PINs do not match");
      return;
    }
    if (hasPin && !isValidPin(currentPin)) {
      toast.error("Enter your current PIN");
      return;
    }

    setSaving(true);
    try {
      await setPin(newPin, hasPin ? currentPin : undefined);
      toast.success(hasPin ? "Transaction PIN updated" : "Transaction PIN set");
      onOpenChange(false);
    } catch (error) {
      toast.error(rpcErrorMessage(error, "Failed to save PIN"));
    } finally {
      setSaving(false);
    }
  };

  return (
    <Sheet open={open} onOpenChange={onOpenChange}>
      <SheetContent side="bottom" className="rounded-t-3xl bg-background">
        <SheetHeader className="text-left pb-4">
          <SheetTitle className="flex items-center gap-2 text-xl font-bold">
            <Lock className="w-5 h-5 text-primary" />
            {hasPin ? "Change transaction PIN" : "Set transaction PIN"}
          </SheetTitle>
          <SheetDescription>
            Your 4-digit PIN is required for withdrawals, sends, sprays, and giveaways.
          </SheetDescription>
        </SheetHeader>

        {loading ? (
          <div className="flex items-center justify-center py-12 text-muted-foreground">
            <Loader2 className="w-5 h-5 animate-spin mr-2" />
            Loading…
          </div>
        ) : (
          <div className="space-y-4 pb-6">
            {hasPin && (
              <PinInput
                id="current-pin"
                label="Current PIN"
                value={currentPin}
                onChange={setCurrentPin}
              />
            )}
            <PinInput id="new-pin" label={hasPin ? "New PIN" : "Choose PIN"} value={newPin} onChange={setNewPin} />
            <PinInput id="confirm-pin" label="Confirm PIN" value={confirmPin} onChange={setConfirmPin} />
            <Button className="w-full" size="lg" onClick={() => void handleSave()} disabled={saving}>
              {saving ? <Loader2 className="w-4 h-4 animate-spin mr-2" /> : null}
              Save PIN
            </Button>
          </div>
        )}
      </SheetContent>
    </Sheet>
  );
};
