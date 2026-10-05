import type { SupabaseClient } from "https://esm.sh/@supabase/supabase-js@2.49.8";
import { flutterwaveApiRequest } from "./psp/flutterwaveClient.ts";
import { fetchBinanceUsdcNgnRateKobo } from "./fx/binance.ts";

/** Order references for Flutterwave hosted checkout. The webhook routes on this prefix. */
export const BUNDLE_TX_REF_PREFIX = "bndl_";

export type BundleSettings = {
  priceKobo: number;
  feeFlatKobo: number;
  feePercent: number;
  minPurchase: number;
  usdcEnabled: boolean;
  usdcMinMicro: number;
  marketRateKobo: number | null;
  sellFlatKobo: number;
  sellPercent: number;
};

export async function getBundleSettings(supabase: SupabaseClient): Promise<BundleSettings> {
  const { data, error } = await supabase
    .from("platform_settings")
    .select(
      "bundle_price_kobo, bundle_fee_flat_kobo, bundle_fee_percent, bundle_min_purchase, bundle_usdc_enabled, bundle_usdc_min_micro, fx_market_rate_kobo, fx_sell_flat_kobo, fx_sell_percent",
    )
    .limit(1)
    .single();
  if (error || !data) throw new Error("Bundle settings unavailable");
  return {
    priceKobo: Number(data.bundle_price_kobo),
    feeFlatKobo: Number(data.bundle_fee_flat_kobo),
    feePercent: Number(data.bundle_fee_percent),
    minPurchase: Number(data.bundle_min_purchase),
    usdcEnabled: Boolean(data.bundle_usdc_enabled),
    usdcMinMicro: Number(data.bundle_usdc_min_micro),
    marketRateKobo: data.fx_market_rate_kobo == null ? null : Number(data.fx_market_rate_kobo),
    sellFlatKobo: Number(data.fx_sell_flat_kobo ?? 0),
    sellPercent: Number(data.fx_sell_percent ?? 0),
  };
}

/** NGN price for N bundles: value + fee (flat + % of value), all kobo. */
export function ngnQuote(bundles: number, s: BundleSettings) {
  const valueKobo = bundles * s.priceKobo;
  const feeKobo = s.feeFlatKobo + Math.floor((valueKobo * s.feePercent) / 100);
  return { valueKobo, feeKobo, totalKobo: valueKobo + feeKobo };
}

/** Effective USDC rate (kobo per USDC) — mirrors fx_compute_sell_rate_kobo. */
export function effectiveSellRateKobo(s: BundleSettings): number | null {
  if (!s.marketRateKobo || s.marketRateKobo <= 0) return null;
  const rate = s.marketRateKobo - s.sellFlatKobo - Math.floor((s.marketRateKobo * s.sellPercent) / 100);
  return rate > 0 ? rate : null;
}

/** USDC needed for N bundles (estimate; the deposit is converted at the rate when it arrives). */
export function usdcQuote(bundles: number, s: BundleSettings) {
  const rate = effectiveSellRateKobo(s);
  if (!rate) return null;
  const { valueKobo, feeKobo, totalKobo } = ngnQuote(bundles, s);
  const usdcMicro = Math.ceil((totalKobo * 1_000_000) / rate);
  return { valueKobo, feeKobo, totalKobo, rateKobo: rate, usdcMicro: Math.max(usdcMicro, s.usdcMinMicro) };
}

type FlwVerifyData = {
  id?: number | string;
  tx_ref?: string;
  status?: string;
  amount?: number;
  currency?: string;
};

/**
 * Credit an NGN checkout order only after Flutterwave's API confirms the payment (never trust a
 * webhook payload's amount). Looks the transaction up by id when known, else by tx_ref.
 */
export async function settleNgnBundleOrder(
  supabase: SupabaseClient,
  input: { txRef: string; transactionId?: string | number | null },
): Promise<{ status: string; bundles?: number; detail?: string }> {
  if (!input.txRef.startsWith(BUNDLE_TX_REF_PREFIX)) return { status: "ignored", detail: "not a bundle order" };
  const path = input.transactionId
    ? `/transactions/${encodeURIComponent(String(input.transactionId))}/verify`
    : `/transactions/verify_by_reference?tx_ref=${encodeURIComponent(input.txRef)}`;
  const res = await flutterwaveApiRequest<{ status?: string; data?: FlwVerifyData }>({ method: "GET", path });
  const data = res.json?.data;
  if (!res.ok || !data) return { status: "unverified", detail: `verify failed (${res.status})` };
  if (String(data.tx_ref ?? "") !== input.txRef) return { status: "unverified", detail: "tx_ref mismatch" };
  if (String(data.status ?? "").toLowerCase() !== "successful") {
    return { status: "not_paid", detail: String(data.status ?? "unknown") };
  }
  const { data: out, error } = await supabase.rpc("settle_ngn_bundle_order", {
    p_tx_ref: input.txRef,
    p_paid_kobo: Math.round(Number(data.amount ?? 0) * 100),
    p_currency: String(data.currency ?? ""),
    p_provider_ref: String(data.id ?? ""),
  });
  if (error) throw error;
  const result = out as { status: string; bundles?: number };
  return { status: result.status, bundles: result.bundles };
}

/**
 * Refresh the USDC/NGN market rate when older than 5 minutes (same rule as fx-quote). Manual
 * rates are never auto-refreshed. Conversions in the DB refuse automatic rates older than 30 min.
 */
export async function refreshMarketRateIfStale(supabase: SupabaseClient): Promise<void> {
  const { data: s } = await supabase
    .from("platform_settings")
    .select("fx_market_rate_kobo, fx_market_rate_updated_at, fx_rate_source")
    .limit(1)
    .single();
  const updatedAt = s?.fx_market_rate_updated_at ? new Date(s.fx_market_rate_updated_at).getTime() : 0;
  const missing = !s?.fx_market_rate_kobo;
  if (!missing && Date.now() - updatedAt <= 5 * 60 * 1000) return;
  if ((s?.fx_rate_source ?? "binance") === "manual" && !missing) return;
  try {
    const { marketRateKobo, raw } = await fetchBinanceUsdcNgnRateKobo();
    await supabase.rpc("update_fx_market_rate", {
      p_market_rate_kobo: marketRateKobo,
      p_source: typeof raw.provider === "string" ? raw.provider : "binance",
      p_raw_payload: raw,
    });
  } catch (err) {
    console.warn("refreshMarketRateIfStale:", err instanceof Error ? err.message : String(err));
  }
}
