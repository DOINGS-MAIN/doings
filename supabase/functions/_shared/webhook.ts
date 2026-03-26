import { getServiceClient } from "./db.ts";

export async function insertWebhookLog(params: {
  provider: string;
  payload: unknown;
  headers: Record<string, string>;
  signature: string | null;
  signatureValid: boolean;
  idempotencyKey: string | null;
  eventType: string | null;
}) {
  const supabase = getServiceClient();
  if (params.idempotencyKey) {
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

  const { data, error } = await supabase
    .from("webhook_logs")
    .insert({
      provider: params.provider,
      payload: params.payload,
      headers: params.headers,
      signature: params.signature,
      signature_valid: params.signatureValid,
      idempotency_key: params.idempotencyKey,
      event_type: params.eventType,
    })
    .select("id")
    .single();

  if (error) throw error;
  return { id: data.id as string, duplicate: false, alreadyProcessed: false };
}

export async function markWebhookProcessed(id: string, errorMessage?: string) {
  const supabase = getServiceClient();
  const patch = errorMessage
    ? { processed: false, processing_error: errorMessage }
    : { processed: true, processed_at: new Date().toISOString(), processing_error: null };

  const { error } = await supabase.from("webhook_logs").update(patch).eq("id", id);
  if (error) throw error;
}
