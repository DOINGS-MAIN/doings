export const PIN_LENGTH = 4;
export const PIN_PATTERN = /^[0-9]{4}$/;

export function isValidPin(pin: string): boolean {
  return PIN_PATTERN.test(pin);
}

export function sanitizePinInput(value: string): string {
  return value.replace(/\D/g, "").slice(0, PIN_LENGTH);
}

export function rpcErrorMessage(err: unknown, fallback = "Something went wrong"): string {
  if (err && typeof err === "object" && "message" in err) {
    const msg = String((err as { message: unknown }).message).trim();
    if (msg) {
      if (/function.*does not exist/i.test(msg) || /PGRST202/i.test(msg)) {
        return "Transaction PIN is not available yet. Please try again after the app is updated.";
      }
      if (/requested function was not found|function not found/i.test(msg)) {
        return "This feature is not available yet. Please try again shortly.";
      }
      return msg;
    }
  }
  if (err instanceof Error && err.message.trim()) return err.message;
  return fallback;
}

export function pinErrorMessage(code?: string): string | null {
  switch (code) {
    case "PIN_NOT_SET":
      return "Set a transaction PIN in Security settings first.";
    case "PIN_LOCKED":
      return "Too many incorrect PIN attempts. Try again in 15 minutes.";
    case "INVALID_PIN":
      return "Incorrect transaction PIN.";
    case "PIN_REQUIRED":
      return "Enter your 4-digit transaction PIN.";
    default:
      return null;
  }
}
