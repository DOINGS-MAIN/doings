import { useSyncExternalStore } from "react";
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
import { answerConfirm, currentConfirm, subscribeConfirm } from "@/lib/confirmDialog";

/** Draws the question asked with confirmDialog(). Mounted once, in the admin layout. */
export function ConfirmHost() {
  const request = useSyncExternalStore(subscribeConfirm, currentConfirm, currentConfirm);
  return (
    <AlertDialog open={request !== null} onOpenChange={(open) => !open && answerConfirm(false)}>
      <AlertDialogContent>
        <AlertDialogHeader>
          <AlertDialogTitle>{request?.title}</AlertDialogTitle>
          <AlertDialogDescription>{request?.message}</AlertDialogDescription>
        </AlertDialogHeader>
        <AlertDialogFooter>
          <AlertDialogCancel onClick={() => answerConfirm(false)}>Cancel</AlertDialogCancel>
          <AlertDialogAction
            onClick={() => answerConfirm(true)}
            className={request?.destructive ? "bg-destructive text-destructive-foreground hover:bg-destructive/90" : undefined}
          >
            {request?.confirmLabel}
          </AlertDialogAction>
        </AlertDialogFooter>
      </AlertDialogContent>
    </AlertDialog>
  );
}
