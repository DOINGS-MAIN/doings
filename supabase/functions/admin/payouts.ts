import type { SupabaseClient } from "https://esm.sh/@supabase/supabase-js@2.49.8";
import { withCors } from "../_shared/cors.ts";
import { orIlike, parsePaging, quoteValue } from "../_shared/adminSearch.ts";
import { failedResolutionGate, payoutCheckRefusal, payoutConfirmMatches } from "../_shared/adminAccess.ts";
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
    // USDC bundle sales are NGN-currency rows that pay out USDC, so they count as USDC here.
    if (currency === "USDC") q = q.or("currency.eq.USDC,metadata->>kind.eq.bundle_sale_usdc");
    if (currency === "NGN") q = q.eq("currency", "NGN").or("metadata->>kind.is.null,metadata->>kind.neq.bundle_sale_usdc");
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
    const row = await loadForCheck(supabase, id);
    if (!row) return withCors({ error: "Payout not found" }, { status: 404 });
    const refusal = payoutCheckRefusal(row);
    if (refusal) return withCors({ error: refusal.error }, { status: refusal.status });

    const checked = await checkWithProvider(supabase, authId, row);
    if ("error" in checked) return withCors({ error: checked.error }, { status: checked.status });
    return withCors({ ok: true, ...checked });
  }

  if (req.method === "POST" && id && action === "resolve") {
    const body = await req.json().catch(() => ({})) as { outcome?: string; reason?: string; confirm?: string };
    const row = await loadForCheck(supabase, id);
    if (!row) return withCors({ error: "Payout not found" }, { status: 404 });
    if (!payoutConfirmMatches(body.confirm, row.idempotency_key)) {
      return withCors({ error: "Type the payout reference to confirm" }, { status: 400 });
    }

    // Marking an NGN bank payout failed refunds the user, so ask the provider live first: a stale
    // or missing check must never be the reason money goes out twice.
    if (body.outcome === "failed" && payoutCheckRefusal(row) === null && row.status !== "failed") {
      const checked = await checkWithProvider(supabase, authId, row);
      if ("error" in checked) {
        return withCors({ error: "Couldn't reach the provider, so it can't safely be marked failed — try again" }, { status: 502 });
      }
      const gate = failedResolutionGate(checked.normalized);
      if (gate.action === "refuse") return withCors({ error: gate.error }, { status: gate.status });
      if (gate.action === "settled") return withCors({ ok: true, status: checked.status, provider_confirmed: true });
    }

    const { data, error } = await supabase.rpc("admin_resolve_payout", {
      p_transaction_id: id, p_outcome: body.outcome ?? "", p_admin_auth_id: authId, p_reason: body.reason ?? "",
    });
    if (error) return withCors({ error: error.message }, { status: 409 });
    return withCors({ ok: true, status: (data as { status?: string })?.status });
  }

  return null;
}

type CheckRow = {
  id: string;
  type: string;
  currency: string;
  status: string;
  provider: string | null;
  provider_ref: string | null;
  idempotency_key: string;
};

async function loadForCheck(supabase: SupabaseClient, id: string): Promise<CheckRow | null> {
  const { data, error } = await supabase.from("transactions")
    .select("id, type, currency, status, provider, provider_ref, idempotency_key")
    .eq("id", id).maybeSingle();
  if (error) throw error;
  return (data as CheckRow | null) ?? null;
}

// Asks the provider about one NGN payout. The answer is recorded first (so it survives a failure
// to apply it), then applied to an open payout exactly as the reconciler would. A payout already
// marked failed is only re-checked: if the provider now says paid, the user has been paid twice,
// so that is flagged loudly and audited instead of being silently ignored.
async function checkWithProvider(
  supabase: SupabaseClient,
  authId: string,
  row: CheckRow,
): Promise<
  | { normalized: string; provider_status: string | null; status: string; paid_after_failed: boolean }
  | { error: string; status: number }
> {
  const platform = await getPlatformPaymentSettings(supabase);
  let outcome;
  try {
    outcome = await fetchTransferStatus(row.provider ?? platform.disbursementProviderId, row.idempotency_key, platform.pspEnv);
  } catch (err) {
    return { error: `Couldn't reach the provider — try again or resolve manually (${String(err instanceof Error ? err.message : err)})`, status: 502 };
  }
  const providerStatus = outcome.providerStatus ?? null;
  const at = new Date().toISOString();
  const paidAfterFailed = row.status === "failed" && outcome.normalized === "terminal_success";

  const { error: mergeErr } = await supabase.rpc("merge_transaction_metadata", {
    p_transaction_id: row.id,
    p_patch: {
      last_provider_check: { status: outcome.normalized, provider_status: providerStatus, at },
      ...(paidAfterFailed ? { provider_paid_after_failed: { at, provider_status: providerStatus } } : {}),
    },
  });
  if (mergeErr) throw mergeErr;

  if (row.status === "pending" || row.status === "processing") {
    await applyWithdrawalStatus(supabase, row, outcome, "reconcile");
  }

  const { data: after, error: afterErr } = await supabase.from("transactions").select("status").eq("id", row.id).maybeSingle();
  if (afterErr) throw afterErr;
  const { error: logErr } = await supabase.rpc("log_admin_action", {
    p_admin_id: authId,
    p_action: paidAfterFailed ? "provider_paid_after_failed" : "check_payout",
    p_target_type: "transaction",
    p_target_id: row.id,
    p_details: { normalized: outcome.normalized, provider_status: providerStatus, status_before: row.status },
  });
  if (logErr) throw logErr;
  return { normalized: outcome.normalized, provider_status: providerStatus, status: after?.status ?? row.status, paid_after_failed: paidAfterFailed };
}
