/**
 * Who may share bundles with another person, and how much in a day.
 *
 * Doings launches as a gifting product: a verified email is enough to share bundles. BVN and selfie
 * are asked for only when someone sells bundles back for cash. The admin switch
 * (platform_settings.share_requires_identity, migration 113) brings back the stricter rule, where
 * sharing needs BVN and selfie too. Limits live in platform_settings and are set from the admin.
 *
 * The error strings are read by the app, which shows its own wording; keep them stable.
 */
export type ShareSettings = { requiresIdentity: boolean; l1Kobo: number; l2Kobo: number };

/** Used when the settings cannot be read (or the database is older than 113): the rule before gifting. */
export const STRICT_SHARE_SETTINGS: ShareSettings = { requiresIdentity: true, l1Kobo: 0, l2Kobo: 500_000_000 };

// USDC is not part of gifting; same figure as TRANSFER_LIMITS in limits.ts (10,000 USDC a day at level 2).
const USDC_DAILY_LIMIT_MICRO = 10_000_000_000;

const wholeOrZero = (value: unknown): number => {
  const n = Number(value);
  return Number.isSafeInteger(n) && n > 0 ? n : 0;
};

export function shareSettingsFromRow(row: Record<string, unknown> | null | undefined): ShareSettings {
  if (!row || typeof row.share_requires_identity !== "boolean") return STRICT_SHARE_SETTINGS;
  return {
    requiresIdentity: row.share_requires_identity,
    l1Kobo: wholeOrZero(row.share_daily_limit_l1_kobo),
    l2Kobo: wholeOrZero(row.share_daily_limit_l2_kobo),
  };
}

/**
 * Settings from a platform_settings read. null means "could not be read": the caller asks the person
 * to try again instead of guessing a limit. Only a database without the 113 columns (Postgres 42703)
 * gets the strict rule, so the function also runs before the migration.
 */
export function shareSettingsFromRead(
  row: Record<string, unknown> | null | undefined,
  error: { code?: string; message?: string } | null | undefined,
): ShareSettings | null {
  if (error) return error.code === "42703" ? STRICT_SHARE_SETTINGS : null;
  return shareSettingsFromRow(row);
}

export type ShareAllowance =
  | { dailyLimit: number }
  | { error: string; code: "EMAIL_REQUIRED" | "IDENTITY_REQUIRED" | "SHARING_OFF" };

const IDENTITY: ShareAllowance = { error: "Complete identity verification (BVN + selfie) to send money", code: "IDENTITY_REQUIRED" };

export function shareAllowance(currency: string, kycLevel: number, settings: ShareSettings): ShareAllowance {
  if (kycLevel < 1) return { error: "Verify your email to share bundles", code: "EMAIL_REQUIRED" };
  // USDC is not part of gifting: unchanged, BVN and its own fixed limit.
  if (currency !== "NGN") return kycLevel >= 2 ? { dailyLimit: USDC_DAILY_LIMIT_MICRO } : IDENTITY;
  if (kycLevel < 2 && settings.requiresIdentity) return IDENTITY;
  const dailyLimit = kycLevel >= 2 ? settings.l2Kobo : settings.l1Kobo;
  if (dailyLimit <= 0) return { error: "Sharing is not available on your account right now", code: "SHARING_OFF" };
  return { dailyLimit };
}
