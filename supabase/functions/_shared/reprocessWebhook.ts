import type { SupabaseClient } from "https://esm.sh/@supabase/supabase-js@2.49.8";
import { applyWithdrawalStatus } from "./psp/withdrawalFinalize.ts";
import { payoutEvent } from "./payoutEvent.ts";
import { markWebhookProcessed, safeProviderRef } from "./webhook.ts";

type WebhookRow = {
  id: string;
  provider: string;
  event_type: string | null;
  payload: Record<string, unknown>;
  signature_valid: boolean | null;
};

const NOT_A_PAYOUT = "Only payout status webhooks can be reprocessed. Deposits are settled by checking the provider.";

/**
 * Applies a stored payout-status webhook again. Two rules keep this from being a way to move money:
 * only a request whose signature verified when it arrived is replayed (an unverified one is anyone's
 * text), and only payout status events are handled. Deposits are never credited from a stored payload.
 */
export async function reprocessWebhookLog(
  supabase: SupabaseClient,
  row: WebhookRow,
): Promise<{ ok: boolean; message: string }> {
  if (row.signature_valid !== true) {
    return { ok: false, message: "This webhook's signature was not verified, so it cannot be reprocessed." };
  }
  const provider = row.provider.toLowerCase();
  try {
    const event = payoutEvent(provider, row.payload);
    if (!event) {
      return { ok: false, message: provider === "monnify" || provider === "nomba" || provider === "flutterwave" ? NOT_A_PAYOUT : `Reprocess not implemented for provider: ${provider}` };
    }
    const ref = safeProviderRef(event.ref);
    if (!ref) {
      await markWebhookProcessed(row.id, "Missing or malformed payout reference");
      return { ok: false, message: "Missing or malformed payout reference" };
    }
    const { data: txn } = await supabase
      .from("transactions")
      .select("id, provider, provider_ref, idempotency_key, status")
      .eq("type", "withdrawal")
      .eq("provider", provider)
      .in("status", ["pending", "processing"])
      .or(`idempotency_key.eq.${ref},provider_ref.eq.${ref}`)
      .maybeSingle();

    if (txn?.id) {
      await applyWithdrawalStatus(supabase, txn, { ...event.outcome, providerRef: ref }, "webhook");
    }
    await markWebhookProcessed(row.id);
    return { ok: true, message: txn?.id ? "Withdrawal updated" : "No matching in-flight withdrawal" };
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err);
    await markWebhookProcessed(row.id, message);
    return { ok: false, message };
  }
}
