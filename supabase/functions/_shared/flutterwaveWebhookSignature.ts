import { hmacSha256Base64 } from "./crypto.ts";

/** Flutterwave v3: dashboard secret hash sent as `verif-hash` header (plain compare). */
export function verifyFlutterwaveVerifHash(signature: string | null, secretHash: string): boolean {
  if (!signature?.trim() || !secretHash.trim()) return false;
  return signature.trim() === secretHash.trim();
}

/** Newer Flutterwave webhooks may send HMAC-SHA256 in `flutterwave-signature`. */
export async function verifyFlutterwaveHmacSignature(input: {
  rawBody: string;
  signature: string | null;
  secret: string;
}): Promise<boolean> {
  if (!input.signature?.trim() || !input.secret.trim()) return false;
  const expected = await hmacSha256Base64(input.secret, input.rawBody);
  return input.signature.trim().toLowerCase() === expected.toLowerCase();
}

export async function verifyFlutterwaveWebhook(input: {
  rawBody: string;
  verifHash: string | null;
  flutterwaveSignature: string | null;
  secretHash: string;
  secretKey: string;
}): Promise<boolean> {
  if (input.secretHash && input.verifHash) {
    if (verifyFlutterwaveVerifHash(input.verifHash, input.secretHash)) return true;
  }
  if (input.secretKey && input.flutterwaveSignature) {
    if (await verifyFlutterwaveHmacSignature({
      rawBody: input.rawBody,
      signature: input.flutterwaveSignature,
      secret: input.secretKey,
    })) {
      return true;
    }
  }
  // No secret configured verifies nothing: the handler refuses such requests, and a forged one must not
  // be stored as genuine in the meantime.
  return false;
}
