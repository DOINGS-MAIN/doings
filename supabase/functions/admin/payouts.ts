import type { SupabaseClient } from "https://esm.sh/@supabase/supabase-js@2.49.8";
import { withCors } from "../_shared/cors.ts";
import { orIlike, parsePaging, quoteValue } from "../_shared/adminSearch.ts";
import { payoutCheckRefusal, payoutConfirmMatches } from "../_shared/adminAccess.ts";
import { getPlatformPaymentSettings } from "../_shared/psp/platformSettings.ts";
import { fetchTransferStatus } from "../_shared/psp/registry.ts";
import { applyWithdrawalStatus } from "../_shared/psp/withdrawalFinalize.ts";

export type AdminRouteCtx = {
  req: Request;
  supabase: SupabaseClient;
  authId: string;
  action?: string;
  id?: string;
  attachUserFields: (rows: Record<string, unknown>[]) => Promise<Record<string, unknown>[]>;
};

const COLUMNS =
  "id, user_id, wallet_id, currency, amount, fee, net_amount, status, provider, provider_ref, idempotency_key, description, metadata, created_at, updated_at, completed_at";
const STATUSES = new Set(["pending", "processing", "completed", "failed", "refunded"]);

// Payouts are withdrawal transactions; bundle sales carry metadata.kind bundle_sale*.
export async function handlePayouts(ctx: AdminRouteCtx): Promise<Response | null> {
  const { req, supabase, authId, action, id } = ctx;
  const url = new URL(req.url);

  if (req.method === "GET" && !id) {
    const { page, limit, from, to } = parsePaging(url.searchParams);
    let q = supabase.from("transactions").select(COLUMNS, { count: "exact" }).eq("type", "withdrawal");
    const status = url.searchParams.get("status");
    if (status && STATUSES.has(status)) q = q.eq("status", status);
    const currency = url.searchParams.get("currency");
    if (currency === "NGN" || currency === "USDC") q = q.eq("currency", currency);
    const kind = url.searchParams.get("kind");
    if (kind === "sale") q = q.like("metadata->>kind", "bundle_sale%");
    if (kind === "withdrawal") q = q.or("metadata->>kind.is.null,metadata->>kind.not.like.bundle_sale*");
    if (url.searchParams.get("needs_review") === "true") q = q.eq("metadata->>needs_review", "true");
    const search = orIlike(["idempotency_key", "provider_ref", "description"], url.searchParams.get("search"));
    if (search) q = q.or(search);
    const { data, count, error } = await q
      .order("created_at", { ascending: false })
      .order("id", { ascending: false })
      .range(from, to);
    if (error) throw error;
    const payouts = await ctx.attachUserFields((data ?? []) as Record<string, unknown>[]);
    return withCors({ payouts, total: count, page, limit });
  }

  if (req.method === "GET" && id) {
    const { data: payout, error } = await supabase.from("transactions").select(COLUMNS).eq("id", id).eq("type", "withdrawal").maybeSingle();
    if (error) throw error;
    if (!payout) return withCors({ error: "Payout not found" }, { status: 404 });
    const [{ data: user }, refs] = [
      await supabase.from("users").select("id, full_name, email, phone, status").eq("id", payout.user_id).maybeSingle(),
      [payout.idempotency_key, payout.provider_ref].filter(Boolean) as string[],
    ];
    const { data: pspEvents } = await supabase.from("psp_events")
      .select("id, provider_id, direction, event_type, status, provider_status, reference, error_message, created_at")
      .or([`transaction_id.eq.${quoteValue(id)}`, ...refs.map((r) => `reference.eq.${quoteValue(r)}`)].join(","))
      .order("created_at", { ascending: true }).limit(50);
    const { data: webhooks } = refs.length
      ? await supabase.from("webhook_logs")
        .select("id, provider, event_type, processed, processing_error, created_at")
        .or(refs.map((r) => `idempotency_key.eq.${quoteValue(r)}`).join(","))
        .order("created_at", { ascending: false }).limit(20)
      : { data: [] };
    return withCors({ payout, user, psp_events: pspEvents ?? [], webhooks: webhooks ?? [] });
  }

  if (req.method === "POST" && id && action === "check") {
    const { data: row } = await supabase.from("transactions")
      .select("id, type, currency, status, provider, provider_ref, idempotency_key, metadata")
      .eq("id", id).maybeSingle();
    if (!row) return withCors({ error: "Payout not found" }, { status: 404 });
    const refusal = payoutCheckRefusal(row as { type: string; currency: string; provider: string | null; status: string });
    if (refusal) return withCors({ error: refusal.error }, { status: refusal.status });

    const platform = await getPlatformPaymentSettings(supabase);
    let outcome;
    try {
      outcome = await fetchTransferStatus(row.provider ?? platform.disbursementProviderId, row.idempotency_key, platform.pspEnv);
    } catch {
      return withCors({ error: "Couldn't reach the provider — try again or resolve manually" }, { status: 502 });
    }
    await applyWithdrawalStatus(supabase, row, outcome, "reconcile");
    await supabase.rpc("merge_transaction_metadata", {
      p_transaction_id: id,
      p_patch: { last_provider_check: { status: outcome.normalized, provider_status: outcome.providerStatus ?? null, at: new Date().toISOString() } },
    });
    const { data: after } = await supabase.from("transactions").select("status").eq("id", id).maybeSingle();
    await supabase.rpc("log_admin_action", {
      p_admin_id: authId, p_action: "check_payout", p_target_type: "transaction", p_target_id: id,
      p_details: { normalized: outcome.normalized, provider_status: outcome.providerStatus ?? null },
    });
    return withCors({ ok: true, normalized: outcome.normalized, provider_status: outcome.providerStatus ?? null, status: after?.status });
  }

  if (req.method === "POST" && id && action === "resolve") {
    const body = await req.json().catch(() => ({})) as { outcome?: string; reason?: string; confirm?: string };
    const { data: row } = await supabase.from("transactions").select("id, idempotency_key").eq("id", id).maybeSingle();
    if (!row) return withCors({ error: "Payout not found" }, { status: 404 });
    if (!payoutConfirmMatches(body.confirm, row.idempotency_key)) {
      return withCors({ error: "Type the payout reference to confirm" }, { status: 400 });
    }
    const { data, error } = await supabase.rpc("admin_resolve_payout", {
      p_transaction_id: id, p_outcome: body.outcome ?? "", p_admin_auth_id: authId, p_reason: body.reason ?? "",
    });
    if (error) return withCors({ error: error.message }, { status: 409 });
    return withCors({ ok: true, status: (data as { status?: string })?.status });
  }

  return null;
}
