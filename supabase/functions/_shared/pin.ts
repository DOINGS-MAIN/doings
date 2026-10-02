import type { SupabaseClient } from "https://esm.sh/@supabase/supabase-js@2.49.8";
import { withCors } from "./cors.ts";

export function isValidPin(pin: unknown): pin is string {
  return typeof pin === "string" && /^[0-9]{4}$/.test(pin);
}

/**
 * Verifies the transaction PIN via check_transaction_pin (migration 073), which *returns* a
 * status so failed attempts and the 15-minute lock actually persist. (The older
 * verify_transaction_pin_internal raised after recording a failure, which rolled the record back.)
 * Responses are unchanged for callers.
 */
export async function requireTransactionPin(
  supabase: SupabaseClient,
  userId: string,
  pin: unknown,
): Promise<Response | null> {
  if (!isValidPin(pin)) {
    return withCors({ error: "Transaction PIN is required", code: "PIN_REQUIRED" }, { status: 400 });
  }

  const { data, error } = await supabase.rpc("check_transaction_pin", {
    p_user_id: userId,
    p_pin: pin,
  });

  if (error) {
    return withCors(
      { error: "PIN verification failed", code: "PIN_ERROR", detail: error.message ?? "" },
      { status: 403 },
    );
  }

  switch (data) {
    case "OK":
      return null;
    case "PIN_REQUIRED":
      return withCors({ error: "Transaction PIN is required", code: "PIN_REQUIRED" }, { status: 400 });
    case "PIN_NOT_SET":
      return withCors({ error: "Set a transaction PIN before continuing", code: "PIN_NOT_SET" }, { status: 403 });
    case "PIN_LOCKED":
      return withCors({
        error: "Too many incorrect PIN attempts. Try again in 15 minutes.",
        code: "PIN_LOCKED",
      }, { status: 429 });
    case "INVALID_PIN":
      return withCors({ error: "Incorrect transaction PIN", code: "INVALID_PIN" }, { status: 403 });
    default:
      return withCors(
        { error: "PIN verification failed", code: "PIN_ERROR", detail: String(data ?? "") },
        { status: 403 },
      );
  }
}
