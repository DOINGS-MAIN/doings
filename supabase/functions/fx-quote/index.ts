import { corsHeaders, withCors } from "../_shared/cors.ts";
import { getAuthUserIdFromRequest, getServiceClient, resolveAppUserId } from "../_shared/db.ts";
import { fetchBinanceUsdcNgnRateKobo } from "../_shared/fx/binance.ts";

type QuoteBody = {
  side: "sell" | "buy";
  /** USDC amount in major units (e.g. 10.5) */
  usdc_amount: number;
};

async function ensureFreshMarketRate(supabase: ReturnType<typeof getServiceClient>): Promise<{
  refreshed: boolean;
  error?: string;
}> {
  const { data: settings } = await supabase
    .from("platform_settings")
    .select("fx_market_rate_kobo, fx_market_rate_updated_at, fx_rate_source")
    .eq("id", 1)
    .single();

  const updatedAt = settings?.fx_market_rate_updated_at
    ? new Date(settings.fx_market_rate_updated_at).getTime()
    : 0;
  const staleMs = 5 * 60 * 1000;
  const missing = !settings?.fx_market_rate_kobo;
  const isStale = missing || Date.now() - updatedAt > staleMs;

  // Auto-refresh for binance (multi-source fetcher) when missing/stale.
  // Manual rates are left alone unless missing.
  const source = settings?.fx_rate_source ?? "binance";
  if (!isStale) return { refreshed: false };
  if (source === "manual" && !missing) return { refreshed: false };

  try {
    const { marketRateKobo, raw } = await fetchBinanceUsdcNgnRateKobo();
    await supabase.rpc("update_fx_market_rate", {
      p_market_rate_kobo: marketRateKobo,
      p_source: typeof raw.provider === "string" ? raw.provider : "binance",
      p_raw_payload: raw,
    });
    return { refreshed: true };
  } catch (err) {
    return { refreshed: false, error: err instanceof Error ? err.message : String(err) };
  }
}

Deno.serve(async (req) => {
  if (req.method === "OPTIONS") return new Response("ok", { headers: corsHeaders });

  const authHeader = req.headers.get("Authorization");
  if (!authHeader) return withCors({ error: "Missing authorization" }, { status: 401 });

  const authUserId = await getAuthUserIdFromRequest(authHeader);
  if (!authUserId) return withCors({ error: "Unauthorized" }, { status: 401 });

  const supabase = getServiceClient();
  const userId = await resolveAppUserId(authHeader);
  if (!userId) return withCors({ error: "User not found" }, { status: 404 });

  const { data: user } = await supabase
    .from("users")
    .select("id, kyc_level")
    .eq("id", userId)
    .single();

  if (!user) return withCors({ error: "User not found" }, { status: 404 });
  if (user.kyc_level < 2) {
    return withCors({ error: "Complete BVN and NIN verification to convert" }, { status: 403 });
  }

  if (req.method === "GET") {
    const refresh = await ensureFreshMarketRate(supabase);
    const { data, error } = await supabase.rpc("get_fx_public_settings");
    if (error) return withCors({ error: error.message }, { status: 500 });
    return withCors({ ok: true, settings: data, rate_refresh: refresh });
  }

  if (req.method !== "POST") return withCors({ error: "Method not allowed" }, { status: 405 });

  const body = (await req.json()) as QuoteBody;
  if (!body.side || body.usdc_amount == null) {
    return withCors({ error: "side and usdc_amount are required" }, { status: 400 });
  }
  if (body.side !== "sell" && body.side !== "buy") {
    return withCors({ error: "side must be sell or buy" }, { status: 400 });
  }

  const usdcMicro = Math.round(body.usdc_amount * 1_000_000);
  if (usdcMicro <= 0) return withCors({ error: "usdc_amount must be positive" }, { status: 400 });

  const refresh = await ensureFreshMarketRate(supabase);

  const { data: quote, error } = await supabase.rpc("create_fx_quote", {
    p_user_id: userId,
    p_side: body.side,
    p_usdc_micro: usdcMicro,
  });

  if (error) {
    const msg = error.message ?? String(error);
    if (msg.includes("disabled") || msg.includes("limit") || msg.includes("Minimum")) {
      return withCors({ error: msg, code: "QUOTE_REJECTED" }, { status: 400 });
    }
    if (msg.includes("unavailable")) {
      return withCors({
        error: refresh.error
          ? `Market rate unavailable. ${refresh.error}`
          : msg,
        code: "RATE_UNAVAILABLE",
      }, { status: 503 });
    }
    return withCors({ error: msg }, { status: 500 });
  }

  return withCors({ ok: true, quote });
});
