/**
 * USDC/NGN reference rate for FX quotes.
 *
 * Binance suspended NGN P2P in 2024, so USDC/NGN ads are usually empty.
 * We still try Binance (correct /adv/search endpoint), then fall back to
 * Bybit public P2P USDT/NGN (USDC ≈ USDT for NGN FX).
 *
 * Returns kobo per 1 whole USDC.
 */

type MedianResult = {
  medianNaira: number;
  prices: number[];
  source: string;
  tradeType: string;
  asset: string;
};

export async function fetchBinanceUsdcNgnRateKobo(): Promise<{
  marketRateKobo: number;
  raw: Record<string, unknown>;
}> {
  const attempts: Record<string, unknown>[] = [];
  const errors: string[] = [];

  // 1) Binance P2P — try USDC then USDT (NGN often empty post-suspension)
  for (const asset of ["USDC", "USDT"] as const) {
    try {
      const [buy, sell] = await Promise.all([
        fetchBinanceP2pMedian(asset, "BUY"),
        fetchBinanceP2pMedian(asset, "SELL"),
      ]);
      attempts.push({ provider: "binance", asset, buy, sell });
      const mid = midFromSides(buy, sell);
      if (mid) {
        return {
          marketRateKobo: Math.round(mid.midNaira * 100),
          raw: {
            provider: "binance",
            asset,
            ...mid,
            attempts,
            note: asset === "USDT"
              ? "Used Binance USDT/NGN (USDC≈USDT) because USDC/NGN ads were unavailable"
              : "Binance USDC/NGN P2P mid",
          },
        };
      }
    } catch (err) {
      errors.push(`binance:${asset}: ${err instanceof Error ? err.message : String(err)}`);
    }
  }

  // 2) Bybit public fiat OTC — USDT/NGN (primary NGN P2P market after Binance exit)
  try {
    const [buy, sell] = await Promise.all([
      fetchBybitP2pMedian("USDT", "0"), // 0 = buy (user buys crypto → seller ads)
      fetchBybitP2pMedian("USDT", "1"), // 1 = sell
    ]);
    attempts.push({ provider: "bybit", asset: "USDT", buy, sell });
    const mid = midFromSides(buy, sell);
    if (mid) {
      return {
        marketRateKobo: Math.round(mid.midNaira * 100),
        raw: {
          provider: "bybit",
          asset: "USDT",
          ...mid,
          attempts,
          note: "Bybit USDT/NGN P2P mid (USDC≈USDT). Binance NGN P2P is unavailable.",
        },
      };
    }
  } catch (err) {
    errors.push(`bybit: ${err instanceof Error ? err.message : String(err)}`);
  }

  throw new Error(
    [
      "Could not fetch USDC/NGN market rate.",
      "Binance NGN P2P is suspended; Bybit USDT/NGN also returned no usable ads.",
      "Set a manual market rate in Admin → FX, or retry later.",
      errors.length ? `Details: ${errors.join(" | ")}` : "",
    ].filter(Boolean).join(" "),
  );
}

function midFromSides(
  buy: MedianResult | null,
  sell: MedianResult | null,
): { midNaira: number; buy_median_naira: number; sell_median_naira: number } | null {
  if (!buy && !sell) return null;
  const buyN = buy?.medianNaira ?? sell!.medianNaira;
  const sellN = sell?.medianNaira ?? buy!.medianNaira;
  const midNaira = (buyN + sellN) / 2;
  if (!(midNaira > 0)) return null;
  return { midNaira, buy_median_naira: buyN, sell_median_naira: sellN };
}

async function fetchBinanceP2pMedian(
  asset: "USDC" | "USDT",
  tradeType: "BUY" | "SELL",
): Promise<MedianResult | null> {
  // Correct public endpoint (portal/search is legacy / often empty)
  const res = await fetch("https://p2p.binance.com/bapi/c2c/v2/friendly/c2c/adv/search", {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      Accept: "application/json",
      "User-Agent":
        "Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36",
      clienttype: "web",
    },
    body: JSON.stringify({
      asset,
      fiat: "NGN",
      tradeType,
      page: 1,
      rows: 10,
      payTypes: [],
      publisherType: "merchant",
      merchantCheck: true,
    }),
  });

  if (!res.ok) {
    const text = await res.text();
    throw new Error(`${tradeType} HTTP ${res.status}: ${text.slice(0, 160)}`);
  }

  const body = await res.json() as {
    data?: { adv?: { price?: string } }[] | null;
  };

  const prices = (body.data ?? [])
    .map((row) => parseFloat(row.adv?.price ?? ""))
    .filter((p) => Number.isFinite(p) && p > 0);

  if (prices.length === 0) return null;

  return {
    medianNaira: median(prices),
    prices,
    source: "binance",
    tradeType,
    asset,
  };
}

/** Bybit public OTC board (no API key). side "0"=buy crypto, "1"=sell crypto. */
async function fetchBybitP2pMedian(
  tokenId: string,
  side: "0" | "1",
): Promise<MedianResult | null> {
  const res = await fetch("https://api2.bybit.com/fiat/otc/item/online", {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      Accept: "application/json",
      "User-Agent":
        "Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36",
    },
    body: JSON.stringify({
      userId: "",
      tokenId,
      currencyId: "NGN",
      payment: [],
      side,
      size: "10",
      page: "1",
      amount: "",
      authMaker: false,
      canTrade: false,
    }),
  });

  if (!res.ok) {
    const text = await res.text();
    throw new Error(`side=${side} HTTP ${res.status}: ${text.slice(0, 160)}`);
  }

  const body = await res.json() as {
    result?: { items?: { price?: string }[] };
    ret_code?: number;
    retCode?: number;
  };

  const items = body.result?.items ?? [];
  const prices = items
    .map((row) => parseFloat(row.price ?? ""))
    .filter((p) => Number.isFinite(p) && p > 0);

  if (prices.length === 0) return null;

  return {
    medianNaira: median(prices),
    prices,
    source: "bybit",
    tradeType: side === "0" ? "BUY" : "SELL",
    asset: tokenId,
  };
}

function median(prices: number[]): number {
  const sorted = [...prices].sort((a, b) => a - b);
  const mid = Math.floor(sorted.length / 2);
  return sorted.length % 2 === 0
    ? (sorted[mid - 1] + sorted[mid]) / 2
    : sorted[mid];
}
