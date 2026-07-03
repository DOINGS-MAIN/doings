import { hmacSha256Base64 } from "./crypto.ts";

/**
 * Nomba signs webhooks with HMAC-SHA256 (base64) over a colon-delimited string.
 * @see https://developer.nomba.com/docs/api-basics/webhook
 */
export function buildNombaSignaturePayload(
  payload: Record<string, unknown>,
  timestamp: string,
): string {
  const data = (payload.data || {}) as Record<string, unknown>;
  const merchant = (data.merchant || {}) as Record<string, unknown>;
  const transaction = (data.transaction || {}) as Record<string, unknown>;

  const eventType = String(payload.event_type ?? payload.eventType ?? "");
  const requestId = String(payload.requestId ?? payload.request_id ?? "");
  const userId = String(merchant.userId ?? merchant.user_id ?? "");
  const walletId = String(merchant.walletId ?? merchant.wallet_id ?? "");
  const transactionId = String(transaction.transactionId ?? transaction.transaction_id ?? "");
  const transactionType = String(transaction.type ?? "");
  const transactionTime = String(transaction.time ?? "");
  let transactionResponseCode = String(transaction.responseCode ?? transaction.response_code ?? "");
  if (transactionResponseCode === "null") transactionResponseCode = "";

  return `${eventType}:${requestId}:${userId}:${walletId}:${transactionId}:${transactionType}:${transactionTime}:${transactionResponseCode}:${timestamp}`;
}

export async function verifyNombaWebhookSignature(input: {
  rawBody: string;
  signature: string | null;
  timestamp: string | null;
  secret: string;
}): Promise<boolean> {
  if (!input.signature?.trim() || !input.timestamp?.trim() || !input.secret.trim()) {
    return false;
  }

  let payload: Record<string, unknown>;
  try {
    payload = JSON.parse(input.rawBody) as Record<string, unknown>;
  } catch {
    return false;
  }

  const hashingPayload = buildNombaSignaturePayload(payload, input.timestamp);
  const expected = await hmacSha256Base64(input.secret, hashingPayload);
  return input.signature.trim().toLowerCase() === expected.toLowerCase();
}
