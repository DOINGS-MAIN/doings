import { getServiceClient } from "./db.ts";
import { UNVERIFIED_ROWS_PER_HOUR, webhookLogRow, type WebhookLogInput } from "./webhookLog.ts";

export { safeProviderRef } from "./webhookLog.ts";

/** `id` is "" when an unverified request was not logged (flood guard); nothing more should happen to it. */
export async function insertWebhookLog(params: WebhookLogInput) {
  const supabase = getServiceClient();
  if (params.signatureValid && params.idempotencyKey) {
    const { data: existing } = await supabase
      .from("webhook_logs")
      .select("id, processed")
      .eq("provider", params.provider)
      .eq("idempotency_key", params.idempotencyKey)
      .limit(1)
      .maybeSingle();

    if (existing?.id) {
      return { id: existing.id as string, duplicate: true, alreadyProcessed: Boolean(existing.processed) };
    }
  }

  if (!params.signatureValid) {
    // Anyone can post here; a flood must not fill the table.
    const { data: allowed } = await supabase.rpc("consume_rate_limit", {
      p_key: `webhook-unverified:${params.provider}`,
      p_max: UNVERIFIED_ROWS_PER_HOUR,
      p_window_seconds: 3600,
    });
    if (allowed === false) return { id: "", duplicate: false, alreadyProcessed: false };
  }

  const { data, error } = await supabase
    .from("webhook_logs")
    .insert(webhookLogRow(params))
    .select("id")
    .single();

  if (error) throw error;
  return { id: data.id as string, duplicate: false, alreadyProcessed: false };
}

export async function markWebhookProcessed(id: string, errorMessage?: string) {
  if (!id) return; // an unlogged, unverified request
  const supabase = getServiceClient();
  const patch = errorMessage
    ? { processed: false, processing_error: errorMessage }
    : { processed: true, processed_at: new Date().toISOString(), processing_error: null };

  const { error } = await supabase.from("webhook_logs").update(patch).eq("id", id);
  if (error) throw error;
}
