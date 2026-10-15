import { withCors } from "../_shared/cors.ts";
import { refreshMarketRateIfStale } from "../_shared/bundles.ts";
import { getServiceClient } from "../_shared/db.ts";

const CRON_SECRET = Deno.env.get("CRON_SECRET") ?? "";

Deno.serve(async (req) => {
  if (req.method !== "POST") return withCors({ error: "Method not allowed" }, { status: 405 });

  const authHeader = req.headers.get("Authorization");
  if (!CRON_SECRET || authHeader !== `Bearer ${CRON_SECRET}`) {
    return withCors({ error: "Unauthorized" }, { status: 401 });
  }

  const supabase = getServiceClient();
  await refreshMarketRateIfStale(supabase);
  const { data: bundlesRetried, error: retryErr } = await supabase.rpc("retry_pending_bundle_orders");
  if (retryErr) console.warn("retry_pending_bundle_orders:", retryErr.message);
  const { data: bundlesExpired, error: expireErr } = await supabase.rpc("expire_stale_bundle_orders");
  if (expireErr) console.warn("expire_stale_bundle_orders:", expireErr.message);

  const { data: cleanup, error: cleanupErr } = await supabase.rpc("cleanup_spray_holds");
  if (cleanupErr) {
    console.warn("cleanup_spray_holds:", cleanupErr.message);
  }
  const { data: floorsAdvanced, error: floorErr } = await supabase.rpc("advance_live_floors");
  if (floorErr) console.warn("advance_live_floors:", floorErr.message);

  const { data: discrepancies, error } = await supabase.rpc("reconcile_wallets");

  if (error) {
    return withCors({ error: "Reconciliation failed", detail: error.message }, { status: 500 });
  }

  const count = discrepancies?.length ?? 0;

  if (count > 0) {
    for (const row of discrepancies) {
      await supabase.from("notifications").insert({
        user_id: row.wallet_id,
        type: "system_alert",
        title: "Balance discrepancy detected",
        body: `Wallet ${row.wallet_id}: balance=${row.wallet_balance}, ledger=${row.ledger_balance}, diff=${row.discrepancy}`,
        data: row,
      }).then(() => {});
    }

    await supabase.from("admin_audit_log").insert({
      admin_id: null,
      action: "reconciliation_alert",
      target_type: "system",
      details: { discrepancy_count: count, wallets: discrepancies },
    }).then(() => {});
  }

  return withCors({
    ok: true,
    reconciled_at: new Date().toISOString(),
    discrepancies_found: count,
    spray_holds_cleaned: cleanup ?? null,
    floors_advanced: floorsAdvanced ?? null,
    bundle_orders_credited: bundlesRetried ?? null,
    bundle_orders_expired: bundlesExpired ?? null,
    discrepancies: count > 0 ? discrepancies : undefined,
  });
});
