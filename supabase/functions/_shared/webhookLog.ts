// Pure rules for what a webhook request may leave in webhook_logs (tested in webhookLog.test.ts).

export type WebhookLogInput = {
  provider: string;
  payload: unknown;
  headers: Record<string, string>;
  signature: string | null;
  signatureValid: boolean;
  idempotencyKey: string | null;
  eventType: string | null;
};

// Headers worth keeping for support. Everything else (verif-hash, signatures, authorization, cookies) is a
// credential or noise: Flutterwave's verif-hash IS the shared secret, so it is never written down.
const KEPT_HEADERS = ["content-type", "user-agent", "x-forwarded-for"];

/** Unverified requests an hour per provider that get a log row; the rest are dropped unlogged. */
export const UNVERIFIED_ROWS_PER_HOUR = 60;

/**
 * The row stored for a webhook request. A request that failed verification keeps no payload and no
 * idempotency key: nothing an admin could replay, nothing that could shadow the real event's key.
 */
export function webhookLogRow(params: WebhookLogInput): Record<string, unknown> {
  const headers: Record<string, string> = {};
  for (const k of KEPT_HEADERS) if (params.headers[k]) headers[k] = params.headers[k];
  return {
    provider: params.provider,
    payload: params.signatureValid ? params.payload : { unverified: true },
    headers,
    signature: null,
    signature_valid: params.signatureValid,
    idempotency_key: params.signatureValid ? params.idempotencyKey : null,
    event_type: params.signatureValid ? params.eventType : (params.eventType ?? "").slice(0, 80) || null,
  };
}

/** A provider reference safe to put in a query filter, or "" (it comes from a request body). */
export function safeProviderRef(ref: string): string {
  return /^[A-Za-z0-9_.:-]{1,120}$/.test(ref) ? ref : "";
}
