/**
 * The admin's own "are you sure?" dialog, asked from anywhere with `await confirmDialog(...)`.
 * It replaces the browser's confirm box, which looks foreign and which automated browsers cancel.
 * One question at a time; <ConfirmHost /> in the admin layout draws it.
 */
export type ConfirmRequest = { message: string; title: string; confirmLabel: string; destructive: boolean };
export type ConfirmOptions = Partial<Omit<ConfirmRequest, "message">>;

let current: (ConfirmRequest & { resolve: (ok: boolean) => void }) | null = null;
const listeners = new Set<() => void>();
const notify = () => listeners.forEach((fn) => fn());

export function confirmDialog(message: string, options: ConfirmOptions = {}): Promise<boolean> {
  // A new question replaces one still open; the old one counts as cancelled.
  current?.resolve(false);
  return new Promise<boolean>((resolve) => {
    current = {
      message,
      title: options.title ?? "Are you sure?",
      confirmLabel: options.confirmLabel ?? "Confirm",
      destructive: options.destructive ?? false,
      resolve,
    };
    notify();
  });
}

export function answerConfirm(ok: boolean): void {
  const open = current;
  if (!open) return;
  current = null;
  open.resolve(ok);
  notify();
}

export const currentConfirm = (): ConfirmRequest | null => current;

export function subscribeConfirm(listener: () => void): () => void {
  listeners.add(listener);
  return () => void listeners.delete(listener);
}
