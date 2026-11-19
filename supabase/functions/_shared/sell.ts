import type { SupabaseClient } from "https://esm.sh/@supabase/supabase-js@2.49.8";
import { isSamePersonName } from "./name-match.ts";

/** Bundle sales (phase 3): helpers shared by `sell`, the old withdraw functions and finalisation. */

export const NAME_MISMATCH_MESSAGE = "This account isn't in your name. Contact support if this is wrong.";

const BASE58 = "123456789ABCDEFGHJKLMNPQRSTUVWXYZabcdefghijkmnopqrstuvwxyz";

/** Byte length of a base58 string, or -1 if it isn't base58. */
function base58ByteLength(s: string): number {
  let n = BigInt(0);
  for (const c of s) {
    const i = BASE58.indexOf(c);
    if (i < 0) return -1;
    n = n * BigInt(58) + BigInt(i);
  }
  let leadingZeros = 0;
  for (const c of s) {
    if (c !== "1") break;
    leadingZeros += 1;
  }
  const hex = n === BigInt(0) ? "" : n.toString(16);
  return leadingZeros + Math.ceil(hex.length / 2);
}

/** A Solana address is base58 for exactly 32 bytes (Tron / Bitcoin base58 addresses are 25). */
export function isSolanaAddress(s: string): boolean {
  const t = s.trim();
  return t.length >= 32 && t.length <= 44 && base58ByteLength(t) === 32;
}

function tokens(name: string): string[] {
  return name.toUpperCase().replace(/[^A-Z\s]/g, "").split(/\s+/).filter(Boolean);
}

/**
 * Strict match of a provider-resolved account name against the BVN legal name. Passes the AML
 * matcher (name-match.ts), or carries every BVN name (BVN stores first + last only,
 * so extra middle names on the bank side must not count against the user).
 */
export function nameMatchesKyc(resolvedName: string, kyc: { first: string; last: string }): boolean {
  const legal = [...tokens(kyc.first), ...tokens(kyc.last)];
  const bank = tokens(resolvedName);
  if (bank.length === 0 || tokens(kyc.first).length === 0 || tokens(kyc.last).length === 0) return false;
  if (isSamePersonName(legal.join(" "), resolvedName)) return true;
  const pool = [...bank];
  for (const t of legal) {
    const i = pool.indexOf(t);
    if (i === -1) return false;
    pool.splice(i, 1);
  }
  return legal.length >= 2;
}

/**
 * May a payout go to this bank account? With the BVN switch on (114) the account must be in the
 * seller's BVN name. With it off there is no verified name to compare, so any account the bank
 * confirms is accepted (owner decision, 2026-11-19).
 */
export function bankNameAccepted(
  resolvedName: string,
  legal: { first: string; last: string } | null,
  matchRequired: boolean,
): boolean {
  if (!resolvedName.trim()) return false;
  if (!matchRequired) return true;
  return !!legal && nameMatchesKyc(resolvedName, legal);
}

/** public.sell_identity_status(): what selling needs now, what the person has done, and the verdict. */
export type SellIdentityStatus = { needs_bvn: boolean; needs_selfie: boolean; has_bvn: boolean; has_selfie: boolean; ok: boolean };

/**
 * The status from the database, or, when it can't be read (or the database is older than 114),
 * the rule from before the switches: BVN and selfie, judged by level 2.
 */
export function sellIdentityFromRow(row: unknown, kycLevel: number): SellIdentityStatus {
  const r = (row && typeof row === "object" ? row : {}) as Record<string, unknown>;
  const keys = ["needs_bvn", "needs_selfie", "has_bvn", "has_selfie", "ok"] as const;
  if (keys.every((k) => typeof r[k] === "boolean")) {
    return { needs_bvn: !!r.needs_bvn, needs_selfie: !!r.needs_selfie, has_bvn: !!r.has_bvn, has_selfie: !!r.has_selfie, ok: !!r.ok };
  }
  const verified = kycLevel >= 2;
  return { needs_bvn: true, needs_selfie: true, has_bvn: verified, has_selfie: verified, ok: verified };
}

/** The legal name from the user's verified level-2 KYC record (never users.full_name). */
export async function getKycLegalName(
  supabase: SupabaseClient,
  userId: string,
): Promise<{ first: string; last: string } | null> {
  const { data } = await supabase
    .from("kyc_verifications")
    .select("bvn_first_name, bvn_last_name")
    .eq("user_id", userId)
    .eq("status", "verified")
    .eq("level", 2)
    .order("created_at", { ascending: false })
    .limit(1)
    .maybeSingle();
  if (!data?.bvn_first_name || !data?.bvn_last_name) return null;
  return { first: String(data.bvn_first_name), last: String(data.bvn_last_name) };
}

/** Bundle sales finalise through their own RPCs (treasury legs / reserve); other withdrawals unchanged. */
export function finalizeRpcNames(kind: string | undefined | null): { complete: string; fail: string } {
  return kind?.startsWith("bundle_sale")
    ? { complete: "complete_bundle_sale", fail: "fail_bundle_sale" }
    : { complete: "complete_withdrawal", fail: "fail_withdrawal" };
}

/**
 * sendUsdc throws "Blockradar request failed: <status> — …" on HTTP errors. Only a 4xx other than
 * 408 / 429 means Blockradar definitely refused the payout (safe to return the bundles); network errors,
 * timeouts, 429 and 5xx are unknown outcomes and must wait for confirmation.
 */
export function isDefiniteBlockradarRejection(err: unknown): boolean {
  const msg = err instanceof Error ? err.message : "";
  const m = /Blockradar request failed: (\d{3})/.exec(msg);
  if (!m) return false;
  const status = Number(m[1]);
  return status >= 400 && status < 500 && status !== 408 && status !== 429;
}
