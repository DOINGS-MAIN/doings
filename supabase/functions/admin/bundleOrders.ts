import { withCors } from "../_shared/cors.ts";
import { orIlike, parsePaging } from "../_shared/adminSearch.ts";
import { settleNgnBundleOrder } from "../_shared/bundles.ts";
import type { AdminRouteCtx } from "./payouts.ts";

const COLUMNS =
  "id, user_id, currency, bundles, fee_kobo, amount, tx_ref, status, provider, provider_ref, failure_reason, credit_transaction_id, " +
  "refund_reference, refund_amount_kobo, refund_note, refunded_at, refunded_by, created_at, updated_at";
const STATUSES = new Set(["awaiting_payment", "credited", "pending_float", "below_minimum", "failed", "expired"]);

export async function handleBundleOrders(ctx: AdminRouteCtx): Promise<Response | null> {
  const { req, supabase, authId, action, id } = ctx;
  const url = new URL(req.url);

  if (req.method === "GET" && !id) {
    const { page, limit, from, to } = parsePaging(url.searchParams);
    let q = supabase.from("bundle_orders").select(COLUMNS, { count: "exact" });
    const status = url.searchParams.get("status");
    if (status && STATUSES.has(status)) q = q.eq("status", status);
    const currency = url.searchParams.get("currency");
    if (currency === "NGN" || currency === "USDC") q = q.eq("currency", currency);
    if (url.searchParams.get("needs_refund") === "true") {
      q = q.eq("currency", "NGN").eq("status", "failed").not("provider_ref", "is", null).neq("provider_ref", "").is("refunded_at", null);
    }
    const search = orIlike(["tx_ref", "provider_ref"], url.searchParams.get("search"));
    if (search) q = q.or(search);
    const { data, count, error } = await q
      .order("created_at", { ascending: false })
      .order("id", { ascending: false })
      .range(from, to);
    if (error) throw error;
    const orders = await ctx.attachUserFields((data ?? []) as Record<string, unknown>[]);
    return withCors({ orders, total: count, page, limit });
  }

  if (req.method === "GET" && id) {
    const { data: order, error } = await supabase.from("bundle_orders").select(COLUMNS).eq("id", id).maybeSingle();
    if (error) throw error;
    if (!order) return withCors({ error: "Order not found" }, { status: 404 });
    const { data: user } = await supabase.from("users").select("id, full_name, email, phone, status").eq("id", order.user_id).maybeSingle();
    const { data: credit } = order.credit_transaction_id
      ? await supabase.from("transactions").select("id, amount, currency, status, created_at").eq("id", order.credit_transaction_id).maybeSingle()
      : { data: null };
    return withCors({ order, user, credit_transaction: credit });
  }

  if (req.method === "POST" && id && action === "check") {
    const { data: order } = await supabase.from("bundle_orders").select("id, currency, status, tx_ref, provider_ref").eq("id", id).maybeSingle();
    if (!order) return withCors({ error: "Order not found" }, { status: 404 });
    if (order.currency !== "NGN" || !["awaiting_payment", "expired"].includes(order.status)) {
      return withCors({ error: "Only NGN orders awaiting payment or expired can be checked" }, { status: 409 });
    }
    let result;
    try {
      result = await settleNgnBundleOrder(supabase, { txRef: order.tx_ref, transactionId: null });
    } catch (err) {
      // Database errors carry a code (e.g. "NGN wallet not found"); anything else is the provider call.
      if (err && typeof err === "object" && "code" in err) {
        return withCors({ error: String((err as { message?: string }).message ?? "Database error") }, { status: 500 });
      }
      return withCors({ error: "Couldn't reach the provider — try again or resolve manually" }, { status: 502 });
    }
    const { error: logErr } = await supabase.rpc("log_admin_action", {
      p_admin_id: authId, p_action: "check_bundle_order", p_target_type: "bundle_order", p_target_id: id, p_details: result,
    });
    if (logErr) throw logErr;
    return withCors({ ok: true, result });
  }

  if (req.method === "POST" && id && action === "refund") {
    const body = await req.json().catch(() => ({})) as { reference?: string; amount_kobo?: number; note?: string };
    const amount = Number(body.amount_kobo);
    if (!Number.isInteger(amount)) return withCors({ error: "amount_kobo must be a whole number" }, { status: 400 });
    const { error } = await supabase.rpc("admin_record_bundle_refund", {
      p_order_id: id, p_admin_auth_id: authId, p_reference: body.reference ?? "", p_amount_kobo: amount, p_note: body.note ?? "",
    });
    if (error) return withCors({ error: error.message }, { status: 409 });
    return withCors({ ok: true });
  }

  return null;
}
