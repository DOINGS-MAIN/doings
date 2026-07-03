import type { SupabaseClient } from "https://esm.sh/@supabase/supabase-js@2.49.8";
import type { PspEventInput } from "./types.ts";

function redact(value: unknown): unknown {
  if (value === null || value === undefined) return value;
  if (typeof value === "string") {
    if (value.length > 512) return `${value.slice(0, 512)}…`;
    return value;
  }
  if (Array.isArray(value)) return value.slice(0, 20).map(redact);
  if (typeof value === "object") {
    const out: Record<string, unknown> = {};
    for (const [k, v] of Object.entries(value as Record<string, unknown>)) {
      const key = k.toLowerCase();
      if (key.includes("secret") || key.includes("password") || key.includes("token") || key.includes("authorization")) {
        out[k] = "[redacted]";
      } else {
        out[k] = redact(v);
      }
    }
    return out;
  }
  return value;
}

export async function logPspEvent(
  supabase: SupabaseClient,
  input: PspEventInput,
): Promise<void> {
  const { error } = await supabase.from("psp_events").insert({
    transaction_id: input.transactionId ?? null,
    provider_id: input.providerId,
    direction: input.direction,
    event_type: input.eventType,
    status: input.status ?? null,
    provider_status: input.providerStatus ?? null,
    reference: input.reference ?? null,
    provider_ref: input.providerRef ?? null,
    request_summary: input.requestSummary ? redact(input.requestSummary) as Record<string, unknown> : null,
    response_summary: input.responseSummary ? redact(input.responseSummary) as Record<string, unknown> : null,
    error_message: input.errorMessage ?? null,
  });

  if (error) {
    console.error("psp_events insert failed:", error.message);
  }
}
