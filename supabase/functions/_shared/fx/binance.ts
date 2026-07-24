/**
 * Fetch USDC/NGN reference rate from Binance P2P (median of top merchant ads).
 * Returns kobo per 1 whole USDC.
 */
export async function fetchBinanceUsdcNgnRateKobo(): Promise<{
  marketRateKobo: number;
  raw: Record<string, unknown>;
}> {
  const [buySide, sellSide] = await Promise.all([
    fetchP2pMedian("BUY"),
    fetchP2pMedian("SELL"),
  ]);

  if (!buySide && !sellSide) {
    throw new Error("Binance P2P returned no USDC/NGN ads");
  }

  const buy = buySide ?? sellSide!;
  const sell = sellSide ?? buySide!;
  const midNaira = (buy + sell) / 2;
  const marketRateKobo = Math.round(midNaira * 100);

  if (marketRateKobo <= 0) {
    throw new Error("Invalid Binance P2P rate");
  }

  return {
    marketRateKobo,
    raw: { buy_median_naira: buy, sell_median_naira: sell, mid_naira: midNaira },
  };
}

async function fetchP2pMedian(tradeType: "BUY" | "SELL"): Promise<number | null> {
  const res = await fetch("https://p2p.binance.com/bapi/c2c/v2/friendly/c2c/portal/search", {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      "Accept": "application/json",
    },
    body: JSON.stringify({
      asset: "USDC",
      fiat: "NGN",
      merchantCheck: true,
      page: 1,
      payTypes: [],
      publisherType: null,
      rows: 10,
      tradeType,
    }),
  });

  if (!res.ok) {
    const text = await res.text();
    throw new Error(`Binance P2P ${tradeType} failed: ${res.status} ${text.slice(0, 200)}`);
  }

  const body = await res.json() as {
    data?: { adv?: { price?: string }[] }[];
  };

  const prices = (body.data ?? [])
    .map((row) => parseFloat(row.adv?.price ?? ""))
    .filter((p) => Number.isFinite(p) && p > 0);

  if (prices.length === 0) return null;

  const sorted = [...prices].sort((a, b) => a - b);
  const mid = Math.floor(sorted.length / 2);
  return sorted.length % 2 === 0
    ? (sorted[mid - 1] + sorted[mid]) / 2
    : sorted[mid];
}
