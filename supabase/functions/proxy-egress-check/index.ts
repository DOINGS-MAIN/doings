/**
 * Auth: service role Bearer OR x-cron-secret matching CRON_SECRET.
 * Verifies Blockradar hostname-swap egress (recommended path).
 */
import { corsHeaders, withCors } from "../_shared/cors.ts";
import { getBlockradarEgressInfo } from "../_shared/blockradar.ts";

function authorized(req: Request): boolean {
  const serviceKey = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY") || "";
  const authHeader = req.headers.get("Authorization") || "";
  if (serviceKey && authHeader === `Bearer ${serviceKey}`) return true;
  const cron = Deno.env.get("CRON_SECRET") || "";
  if (cron && req.headers.get("x-cron-secret") === cron) return true;
  return false;
}

Deno.serve(async (req) => {
  if (req.method === "OPTIONS") return new Response("ok", { headers: corsHeaders });
  if (!authorized(req)) {
    return withCors({ ok: false, error: "unauthorized" }, { status: 401 });
  }

  const info = getBlockradarEgressInfo();
  const base = String(info.baseUrl || "https://api.blockradar.co").replace(/\/$/, "");
  const probes: Record<string, unknown> = {};

  // Plain HTTPS to configured base (hostname swap or direct) — no CONNECT proxy
  try {
    const res = await fetch(`${base}/v1/`, {
      method: "GET",
      headers: { "x-api-key": Deno.env.get("BLOCKRADAR_API_KEY") ?? "" },
    });
    const body = await res.text();
    probes.blockradarV1 = {
      ok: res.status < 500,
      status: res.status,
      body: body.replace(/\s+/g, " ").slice(0, 240),
    };
  } catch (e) {
    probes.blockradarV1 = { ok: false, error: String(e) };
  }

  // Confirm Edge can reach Static IP Relay host over 443
  if (info.mode === "hostname_swap") {
    try {
      const res = await fetch(base + "/", { method: "GET" });
      probes.relayRoot = {
        status: res.status,
        server: res.headers.get("server"),
      };
    } catch (e) {
      probes.relayRoot = { error: String(e) };
    }
  }

  return withCors({
    ok: true,
    egress: info,
    probes,
    setup: {
      step1: "Static IP Relay → New Relay → HTTP → Target URL = https://api.blockradar.co",
      step2: "Copy relay URL e.g. https://abcd.staticiprelay.com → secret BLOCKRADAR_BASE_URL",
      step3: "Copy dedicated static IP → Blockradar Dashboard → Developers → IP whitelisting",
      step4: "Do NOT rely on Advanced Proxy :3128 for Supabase Edge + Blockradar",
      officialApi: "https://api.blockradar.co/v1",
    },
  });
});
