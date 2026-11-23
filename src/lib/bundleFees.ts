/**
 * The fees charged when someone buys or sells bundles (platform_settings.bundle_fee_* and
 * bundle_sell_fee_*, set through set_bundle_fee_settings, migration 117). Each is a flat part in
 * naira plus a percentage of the value; one bundle is worth one naira.
 */
export type FeeInputs = { buyPercent: string; buyFlat: string; sellPercent: string; sellFlat: string };
export type FeeSettings = FeeInputs & { minSell: number; minPurchase: number };
export type FeesPayload = { _buy_fee_percent: number; _buy_fee_flat_kobo: number; _sell_fee_percent: number; _sell_fee_flat_kobo: number };

const tidy = (n: number) => String(Number(n.toFixed(2)));

export function feesFromSettings(s: Record<string, unknown>): FeeSettings {
  return {
    buyPercent: tidy(Number(s.buy_fee_percent ?? 0)),
    buyFlat: tidy(Number(s.buy_fee_flat_kobo ?? 0) / 100),
    sellPercent: tidy(Number(s.sell_fee_percent ?? 0)),
    sellFlat: tidy(Number(s.sell_fee_flat_kobo ?? 0) / 100),
    minSell: Number(s.bundle_sell_min ?? 0),
    minPurchase: Number(s.bundle_min_purchase ?? 0),
  };
}

/** The fee in naira on a value in bundles: flat + percent, to the kobo, rounded down like the server. */
export function feeOn(bundles: number, percent: number, flatNaira: number): number {
  const kobo = Math.round(flatNaira * 100) + Math.floor((bundles * 100 * percent) / 100);
  return kobo / 100;
}

export const sellFeeTooHigh = (minSell: number, percent: number, flatNaira: number): boolean =>
  minSell > 0 && feeOn(minSell, percent, flatNaira) >= minSell;

function read(text: string, what: string, percent: boolean): number | { error: string } {
  const n = text.trim() === "" ? Number.NaN : Number(text);
  if (!Number.isFinite(n)) return { error: `Enter the ${what}` };
  if (n < 0) return { error: `The ${what} cannot be negative` };
  if (percent && n >= 50) return { error: `The ${what} must be below 50` };
  return n;
}

export function feesPayload(inputs: FeeInputs): FeesPayload | { error: string } {
  const bp = read(inputs.buyPercent, "buy fee percentage", true);
  if (typeof bp !== "number") return bp;
  const bf = read(inputs.buyFlat, "buy flat fee", false);
  if (typeof bf !== "number") return bf;
  const sp = read(inputs.sellPercent, "sell fee percentage", true);
  if (typeof sp !== "number") return sp;
  const sf = read(inputs.sellFlat, "sell flat fee", false);
  if (typeof sf !== "number") return sf;
  return { _buy_fee_percent: bp, _buy_fee_flat_kobo: Math.round(bf * 100), _sell_fee_percent: sp, _sell_fee_flat_kobo: Math.round(sf * 100) };
}
