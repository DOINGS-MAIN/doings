/**
 * HMAC-SHA256 (lowercase hex) of a BVN/NIN with KYC_HASH_SECRET. Same output as Node's
 * createHmac("sha256", secret).update(value).digest("hex"), which the backfill script uses.
 */
export async function kycHmac(value: string, secret: string): Promise<string> {
  const enc = new TextEncoder();
  const key = await crypto.subtle.importKey("raw", enc.encode(secret), { name: "HMAC", hash: "SHA-256" }, false, [
    "sign",
  ]);
  const sig = await crypto.subtle.sign("HMAC", key, enc.encode(value));
  return Array.from(new Uint8Array(sig), (b) => b.toString(16).padStart(2, "0")).join("");
}
