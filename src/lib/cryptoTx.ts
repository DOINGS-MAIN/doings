/** Helpers for on-chain USDC / Solana track IDs shown in user + admin UIs. */

const DOINGS_REF_RE = /^DOINGS-/i;

/** Solana signatures are base58 and typically 87–88 chars. */
export function isLikelySolanaSignature(value: string | null | undefined): boolean {
  if (!value) return false;
  const v = value.trim();
  if (v.length < 80 || v.length > 100) return false;
  if (DOINGS_REF_RE.test(v)) return false;
  return /^[1-9A-HJ-NP-Za-km-z]+$/.test(v);
}

export function getCryptoTrackId(input: {
  providerRef?: string | null;
  metadata?: Record<string, unknown> | null;
  currency?: string;
  provider?: string;
}): string | null {
  const metaHash = input.metadata?.tx_hash;
  if (typeof metaHash === "string" && isLikelySolanaSignature(metaHash)) {
    return metaHash.trim();
  }

  const ref = (input.providerRef ?? "").trim();
  if (isLikelySolanaSignature(ref)) return ref;

  // Deposit provider_ref is often the chain hash even when shorter heuristics differ
  if (
    input.currency === "USDC" &&
    (input.provider === "blockradar" || !input.provider) &&
    ref &&
    !DOINGS_REF_RE.test(ref) &&
    ref.length >= 40
  ) {
    return ref;
  }

  return null;
}

export function solanaExplorerTxUrl(signature: string): string {
  return `https://solscan.io/tx/${encodeURIComponent(signature)}`;
}

export function shortenCryptoId(id: string, head = 8, tail = 6): string {
  if (id.length <= head + tail + 1) return id;
  return `${id.slice(0, head)}…${id.slice(-tail)}`;
}
