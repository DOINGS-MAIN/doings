import { useEffect, useState, useSyncExternalStore } from "react";
import {
  AlertDialog,
  AlertDialogAction,
  AlertDialogCancel,
  AlertDialogContent,
  AlertDialogDescription,
  AlertDialogFooter,
  AlertDialogHeader,
  AlertDialogTitle,
} from "@/components/ui/alert-dialog";
import { Label } from "@/components/ui/label";
import { Textarea } from "@/components/ui/textarea";
import { answerConfirm, currentConfirm, subscribeConfirm } from "@/lib/confirmDialog";

/** Draws the question asked with confirmDialog() or confirmWithReason(). Mounted once, in the admin layout. */
export function ConfirmHost() {
  const request = useSyncExternalStore(subscribeConfirm, currentConfirm, currentConfirm);
  const [reason, setReason] = useState("");
  // Each question starts with an empty reason box.
  useEffect(() => setReason(""), [request]);
  const missingReason = !!request?.reason?.required && !reason.trim();
  return (
    <AlertDialog open={request !== null} onOpenChange={(open) => !open && answerConfirm(false)}>
      <AlertDialogContent>
        <AlertDialogHeader>
          <AlertDialogTitle>{request?.title}</AlertDialogTitle>
          <AlertDialogDescription>{request?.message}</AlertDialogDescription>
        </AlertDialogHeader>
        {request?.reason && (
          <div className="space-y-2">
            <Label htmlFor="confirm-reason">{request.reason.label}</Label>
            <Textarea id="confirm-reason" value={reason} onChange={(e) => setReason(e.target.value)} maxLength={500} />
          </div>
        )}
        <AlertDialogFooter>
          <AlertDialogCancel onClick={() => answerConfirm(false)}>Cancel</AlertDialogCancel>
          <AlertDialogAction
            disabled={missingReason}
            onClick={() => answerConfirm(true, reason)}
            className={request?.destructive ? "bg-destructive text-destructive-foreground hover:bg-destructive/90" : undefined}
          >
            {request?.confirmLabel}
          </AlertDialogAction>
        </AlertDialogFooter>
      </AlertDialogContent>
    </AlertDialog>
  );
}
