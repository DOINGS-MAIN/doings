import { corsHeaders, withCors } from "../_shared/cors.ts";
import { getAuthUserIdFromRequest, getServiceClient } from "../_shared/db.ts";
import { generateDepositAddress } from "../_shared/blockradar.ts";
import { DEFAULT_STORAGE_NETWORK } from "../_shared/blockradarNetwork.ts";
import { flutterwaveApiRequest } from "../_shared/psp/flutterwaveClient.ts";
import {
  BUNDLE_TX_REF_PREFIX,
  getBundleSettings,
  ngnQuote,
  refreshMarketRateIfStale,
  settleNgnBundleOrder,
  usdcQuote,
} from "../_shared/bundles.ts";

/**
 * Buy bundles (1 bundle = bundle_price_kobo on the NGN ledger). KYC level 1.
 *   GET  /bundles/quote?bundles=N&currency=NGN|USDC
 *   POST /bundles/checkout { bundles, currency: "NGN", return_origin }  -> Flutterwave hosted link
 *   POST /bundles/checkout { bundles, currency: "USDC" }                -> Solana deposit address
 *   GET  /bundles/orders?since=ISO         own orders (USDC deposits appear here when they land)
 *   GET  /bundles/orders/:id               one own order
 *   POST /bundles/orders/:id/verify        re-check an NGN order with Flutterwave (redirect return)
 */

const ORDER_COLUMNS = "id, currency, bundles, fee_kobo, amount, status, failure_reason, created_at, updated_at";
const MAX_BUNDLES = 100_000_000;

function allowedOrigins(): string[] {
  return (Deno.env.get("ALLOWED_APP_ORIGINS") ?? "http://localhost:3005")
    .split(",")
    .map((s) => s.trim().replace(/\/$/, ""))
    .filter(Boolean);
}

function parseBundles(raw: unknown): number | null {
  const n = Number(raw);
  return Number.isInteger(n) && n > 0 && n <= MAX_BUNDLES ? n : null;
}

Deno.serve(async (req) => {
  if (req.method === "OPTIONS") return new Response("ok", { headers: corsHeaders });

  const authUserId = await getAuthUserIdFromRequest(req.headers.get("Authorization"));
  if (!authUserId) return withCors({ error: "Unauthorized" }, { status: 401 });

  const supabase = getServiceClient();
  const { data: user } = await supabase
    .from("users")
    .select("id, kyc_level, email, full_name, username")
    .eq("auth_id", authUserId)
    .maybeSingle();
  if (!user) return withCors({ error: "User not found" }, { status: 404 });
  if (user.kyc_level < 1) return withCors({ error: "Verify your email to buy bundles" }, { status: 403 });

  const url = new URL(req.url);
  const parts = url.pathname.split("/").filter(Boolean);
  const rest = parts.slice(parts.indexOf("bundles") + 1);

  try {
    if (req.method === "GET" && rest[0] === "quote" && (url.searchParams.get("currency") ?? "").toUpperCase() === "USDC") {
      await refreshMarketRateIfStale(supabase);
    }
    const settings = await getBundleSettings(supabase);

    // ── Quote ──
    if (req.method === "GET" && rest[0] === "quote") {
      const bundles = parseBundles(url.searchParams.get("bundles"));
      if (!bundles) return withCors({ error: "Enter how many bundles to buy" }, { status: 400 });
      if (bundles < settings.minPurchase) {
        return withCors({ error: `Minimum purchase is ${settings.minPurchase.toLocaleString()} bundles` }, { status: 400 });
      }
      const currency = (url.searchParams.get("currency") ?? "NGN").toUpperCase();
      if (currency === "USDC") {
        if (!settings.usdcEnabled) return withCors({ error: "USDC purchases are paused" }, { status: 400 });
        const q = usdcQuote(bundles, settings);
        if (!q) return withCors({ error: "USDC rate unavailable. Try again shortly." }, { status: 503 });
        return withCors({
          ok: true, currency, bundles, fee_kobo: q.feeKobo, total_kobo: q.totalKobo,
          usdc_micro: q.usdcMicro, rate_kobo: q.rateKobo, usdc_min_micro: settings.usdcMinMicro,
        });
      }
      if (currency !== "NGN") return withCors({ error: "currency must be NGN or USDC" }, { status: 400 });
      const q = ngnQuote(bundles, settings);
      return withCors({ ok: true, currency, bundles, fee_kobo: q.feeKobo, total_kobo: q.totalKobo });
    }

    // ── Checkout ──
    if (req.method === "POST" && rest[0] === "checkout") {
      const body = await req.json().catch(() => ({})) as Record<string, unknown>;
      const bundles = parseBundles(body.bundles);
      if (!bundles) return withCors({ error: "Enter how many bundles to buy" }, { status: 400 });
      if (bundles < settings.minPurchase) {
        return withCors({ error: `Minimum purchase is ${settings.minPurchase.toLocaleString()} bundles` }, { status: 400 });
      }
      const currency = String(body.currency ?? "NGN").toUpperCase();

      if (currency === "USDC") {
        if (!settings.usdcEnabled) return withCors({ error: "USDC purchases are paused" }, { status: 400 });
        await refreshMarketRateIfStale(supabase);
        const q = usdcQuote(bundles, await getBundleSettings(supabase));
        if (!q) return withCors({ error: "USDC rate unavailable. Try again shortly." }, { status: 503 });
        const { data: wallet } = await supabase
          .from("wallets").select("id").eq("user_id", user.id).eq("currency", "USDC").maybeSingle();
        if (!wallet) return withCors({ error: "USDC wallet not found" }, { status: 500 });
        const { data: existing } = await supabase
          .from("wallet_addresses").select("address, network")
          .eq("wallet_id", wallet.id).eq("provider", "blockradar").eq("network", DEFAULT_STORAGE_NETWORK)
          .maybeSingle();
        let address = existing?.address as string | undefined;
        if (!address) {
          const generated = await generateDepositAddress({ userId: user.id });
          address = generated.address;
          const { error: insErr } = await supabase.from("wallet_addresses").insert({
            wallet_id: wallet.id, provider: "blockradar", address, network: DEFAULT_STORAGE_NETWORK,
            label: `DOINGS-${user.id}`,
          });
          if (insErr) throw insErr;
        }
        return withCors({
          ok: true, currency, bundles, address, network: "Solana", asset: "USDC",
          usdc_micro: q.usdcMicro, usdc_min_micro: settings.usdcMinMicro, rate_kobo: q.rateKobo,
          fee_kobo: q.feeKobo, started_at: new Date().toISOString(),
        });
      }

      if (currency !== "NGN") return withCors({ error: "currency must be NGN or USDC" }, { status: 400 });
      const origin = String(body.return_origin ?? "").replace(/\/$/, "");
      if (!allowedOrigins().includes(origin)) {
        return withCors({ error: "Checkout is not available from this app address" }, { status: 400 });
      }
      const q = ngnQuote(bundles, settings);
      const txRef = `${BUNDLE_TX_REF_PREFIX}${crypto.randomUUID().replace(/-/g, "")}`;
      const { data: order, error: orderErr } = await supabase
        .from("bundle_orders")
        .insert({
          user_id: user.id, currency: "NGN", bundles, fee_kobo: q.feeKobo, amount: q.totalKobo,
          tx_ref: txRef, status: "awaiting_payment", provider: "flutterwave",
        })
        .select("id").single();
      if (orderErr || !order) throw orderErr ?? new Error("Could not create order");

      const pay = await flutterwaveApiRequest<{ status?: string; message?: string; data?: { link?: string } }>({
        method: "POST",
        path: "/payments",
        body: {
          tx_ref: txRef,
          amount: q.totalKobo / 100,
          currency: "NGN",
          redirect_url: `${origin}/buy/complete?order=${order.id}`,
          customer: { email: user.email, name: user.full_name || user.username || "Doings user" },
          customizations: { title: "Doings bundles", description: `${bundles.toLocaleString()} bundles` },
          meta: { bundle_order_id: order.id },
        },
      });
      const link = pay.json?.data?.link;
      if (!pay.ok || !link) {
        await supabase.from("bundle_orders")
          .update({ status: "failed", failure_reason: `checkout init failed (${pay.status})`, updated_at: new Date().toISOString() })
          .eq("id", order.id);
        return withCors({ error: "Could not start checkout. Please try again." }, { status: 502 });
      }
      return withCors({ ok: true, currency, order_id: order.id, link, total_kobo: q.totalKobo, fee_kobo: q.feeKobo });
    }

    // ── Orders ──
    if (req.method === "GET" && rest[0] === "orders" && !rest[1]) {
      let query = supabase.from("bundle_orders").select(ORDER_COLUMNS).eq("user_id", user.id)
        .order("created_at", { ascending: false }).limit(20);
      const since = url.searchParams.get("since");
      if (since && !Number.isNaN(Date.parse(since))) query = query.gte("created_at", since);
      const { data, error } = await query;
      if (error) throw error;
      return withCors({ ok: true, orders: data ?? [] });
    }

    if (rest[0] === "orders" && rest[1]) {
      const { data: order } = await supabase.from("bundle_orders")
        .select(`${ORDER_COLUMNS}, tx_ref`).eq("id", rest[1]).eq("user_id", user.id).maybeSingle();
      if (!order) return withCors({ error: "Order not found" }, { status: 404 });

      if (req.method === "POST" && rest[2] === "verify" && order.currency === "NGN" && order.status === "awaiting_payment") {
        await settleNgnBundleOrder(supabase, { txRef: order.tx_ref });
        const { data: fresh } = await supabase.from("bundle_orders").select(ORDER_COLUMNS).eq("id", order.id).single();
        return withCors({ ok: true, order: fresh });
      }
      if (req.method === "GET" || rest[2] === "verify") {
        const { tx_ref: _ref, ...publicOrder } = order;
        return withCors({ ok: true, order: publicOrder });
      }
    }

    return withCors({ error: "Not found" }, { status: 404 });
  } catch (err) {
    console.error("bundles error:", err);
    return withCors({ error: "Something went wrong. Please try again." }, { status: 500 });
  }
});
