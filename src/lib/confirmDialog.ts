/**
 * The admin's own "are you sure?" dialog, asked from anywhere with `await confirmDialog(...)`.
 * It replaces the browser's confirm box, which looks foreign and which automated browsers cancel.
 * `confirmWithReason(...)` is the same dialog with a box for a reason.
 * One question at a time; <ConfirmHost /> in the admin layout draws it.
 */
export type ConfirmRequest = {
  message: string;
  title: string;
  confirmLabel: string;
  destructive: boolean;
  /** The reason box, when the question has one. */
  reason: { label: string; required: boolean } | null;
};
export type ConfirmOptions = Partial<Pick<ConfirmRequest, "title" | "confirmLabel" | "destructive">>;
export type ReasonOptions = ConfirmOptions & { reasonLabel?: string; reasonRequired?: boolean };

// Answered with the reason typed ("" when there is none), or null when cancelled.
let current: (ConfirmRequest & { resolve: (answer: string | null) => void }) | null = null;
const listeners = new Set<() => void>();
const notify = () => listeners.forEach((fn) => fn());

function ask(message: string, options: ConfirmOptions, reason: ConfirmRequest["reason"]): Promise<string | null> {
  // A new question replaces one still open; the old one counts as cancelled.
  current?.resolve(null);
  return new Promise<string | null>((resolve) => {
    current = {
      message,
      title: options.title ?? "Are you sure?",
      confirmLabel: options.confirmLabel ?? "Confirm",
      destructive: options.destructive ?? false,
      reason,
      resolve,
    };
    notify();
  });
}

export function confirmDialog(message: string, options: ConfirmOptions = {}): Promise<boolean> {
  return ask(message, options, null).then((answer) => answer !== null);
}

/** Resolves with the reason typed ("" when it was left empty and is optional), or null on cancel. */
export function confirmWithReason(message: string, options: ReasonOptions = {}): Promise<string | null> {
  const required = options.reasonRequired ?? false;
  return ask(message, options, { label: options.reasonLabel ?? (required ? "Reason" : "Reason (optional)"), required });
}

export function answerConfirm(ok: boolean, reason = ""): void {
  const open = current;
  if (!open) return;
  const typed = reason.trim();
  if (ok && open.reason?.required && !typed) return;
  current = null;
  open.resolve(ok ? typed : null);
  notify();
}

export const currentConfirm = (): ConfirmRequest | null => current;

export function subscribeConfirm(listener: () => void): () => void {
  listeners.add(listener);
  return () => void listeners.delete(listener);
}
