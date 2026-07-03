import type { SupabaseClient } from "https://esm.sh/@supabase/supabase-js@2.49.8";
import { withCors } from "./cors.ts";

export function isValidPin(pin: unknown): pin is string {
  return typeof pin === "string" && /^[0-9]{4}$/.test(pin);
}

export async function requireTransactionPin(
  supabase: SupabaseClient,
  userId: string,
  pin: unknown,
): Promise<Response | null> {
  if (!isValidPin(pin)) {
    return withCors({ error: "Transaction PIN is required", code: "PIN_REQUIRED" }, { status: 400 });
  }

  const { error } = await supabase.rpc("verify_transaction_pin_internal", {
    p_user_id: userId,
    p_pin: pin,
  });

  if (error) {
    const msg = error.message ?? "";
    if (msg.includes("PIN_NOT_SET")) {
      return withCors({ error: "Set a transaction PIN before continuing", code: "PIN_NOT_SET" }, { status: 403 });
    }
    if (msg.includes("PIN_LOCKED")) {
      return withCors({
        error: "Too many incorrect PIN attempts. Try again in 15 minutes.",
        code: "PIN_LOCKED",
      }, { status: 429 });
    }
    if (msg.includes("INVALID_PIN")) {
      return withCors({ error: "Incorrect transaction PIN", code: "INVALID_PIN" }, { status: 403 });
    }
    return withCors({ error: "PIN verification failed", code: "PIN_ERROR", detail: msg }, { status: 403 });
  }

  return null;
}
