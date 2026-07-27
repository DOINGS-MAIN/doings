import { corsHeaders, withCors } from "../_shared/cors.ts";
import { getAuthUserIdFromRequest, getServiceClient } from "../_shared/db.ts";
import { fetchBinanceUsdcNgnRateKobo } from "../_shared/fx/binance.ts";

/** Refresh Binance USDC/NGN market rate and persist to platform_settings. */
Deno.serve(async (req) => {
  if (req.method === "OPTIONS") return new Response("ok", { headers: corsHeaders });

  const cronSecret = Deno.env.get("CRON_SECRET");
  const authHeader = req.headers.get("Authorization");
  const isCron = cronSecret && authHeader === `Bearer ${cronSecret}`;

  if (!isCron) {
    if (req.method !== "POST") return withCors({ error: "Method not allowed" }, { status: 405 });
    const userId = await getAuthUserIdFromRequest(authHeader ?? "");
    if (!userId) return withCors({ error: "Unauthorized" }, { status: 401 });

    const supabase = getServiceClient();
    const { data: adminRole } = await supabase
      .from("admin_roles")
      .select("role")
      .eq("user_id", userId)
      .eq("status", "active")
      .maybeSingle();

    if (!adminRole || !["super_admin", "finance"].includes(adminRole.role)) {
      return withCors({ error: "Forbidden" }, { status: 403 });
    }
  }

  try {
    const { marketRateKobo, raw } = await fetchBinanceUsdcNgnRateKobo();
    const supabase = getServiceClient();

    const { data, error } = await supabase.rpc("update_fx_market_rate", {
      p_market_rate_kobo: marketRateKobo,
      p_source: typeof raw.provider === "string" ? raw.provider : "binance",
      p_raw_payload: raw,
    });

    if (error) throw error;

    return withCors({
      ok: true,
      market_rate_kobo: marketRateKobo,
      market_rate_naira: marketRateKobo / 100,
      provider: raw.provider ?? null,
      note: raw.note ?? null,
      ...(data as Record<string, unknown> ?? {}),
    });
  } catch (err) {
    return withCors({ error: "Failed to refresh FX rate", detail: String(err) }, { status: 502 });
  }
});
