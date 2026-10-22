/**
 * The one place money units are parsed and converted on the server. Amounts are stored as integers in a
 * smallest unit: kobo for NGN and bundles (100 kobo = ₦1 = 1 bundle) and micro-units for USDC
 * (1,000,000 micro = 1 USDC). Requests carry major units (bundles, naira, USDC); this module turns them into the
 * smallest unit and refuses anything that is not a plain positive number, so a malformed amount can never
 * slip past a `<= 0` check as NaN.
 */
export type MoneyCurrency = "NGN" | "USDC";

export const KOBO_PER_NAIRA = 100;
/** A bundle is worth ₦1 (platform_settings.bundle_price_kobo = 100). */
export const KOBO_PER_BUNDLE = KOBO_PER_NAIRA;
export const MICRO_PER_USDC = 1_000_000;

const SCALE: Record<MoneyCurrency, number> = { NGN: KOBO_PER_NAIRA, USDC: MICRO_PER_USDC };
const PLAIN_NUMBER = /^\d+(\.\d+)?$/;

/** A finite number from a JSON number or a plain digit string ("1000", "1000.50"); anything else is null. */
function toNumber(value: unknown): number | null {
  if (typeof value === "number") return Number.isFinite(value) ? value : null;
  if (typeof value === "string" && PLAIN_NUMBER.test(value.trim())) return Number(value.trim());
  return null;
}

/**
 * A major-unit amount (naira / bundles, or USDC) as whole smallest units, or null when it is not a finite
 * number above zero, has more decimals than the currency has (NGN 2, USDC 6), or is too large to be exact.
 * "10,000", NaN, Infinity, "", null, 0 and negatives are all null.
 */
export function parseMajorAmount(value: unknown, currency: MoneyCurrency = "NGN"): number | null {
  const n = toNumber(value);
  if (n === null || n <= 0) return null;
  const scaled = n * SCALE[currency];
  const whole = Math.round(scaled);
  if (Math.abs(scaled - whole) > 1e-6) return null; // more decimals than the currency has
  return whole > 0 && Number.isSafeInteger(whole) ? whole : null;
}

/** A whole positive count (bundles) up to `max`, from a number or a plain digit string; otherwise null. */
export function parseWholeAmount(value: unknown, max = Number.MAX_SAFE_INTEGER): number | null {
  const n = toNumber(value);
  return n !== null && Number.isInteger(n) && n > 0 && n <= max ? n : null;
}

/** Smallest unit → major unit, for responses that report naira / USDC. */
export const koboToMajor = (kobo: number): number => kobo / KOBO_PER_NAIRA;
export const microToMajor = (micro: number): number => micro / MICRO_PER_USDC;
/** Whole bundles → kobo (1 bundle = ₦1). */
export const bundlesToKobo = (bundles: number): number => bundles * KOBO_PER_BUNDLE;
