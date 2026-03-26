import { withCors } from "../_shared/cors.ts";
import { getServiceClient } from "../_shared/db.ts";

const CRON_SECRET = Deno.env.get("CRON_SECRET") ?? "";

Deno.serve(async (req) => {
  if (req.method !== "POST") return withCors({ error: "Method not allowed" }, { status: 405 });

  const authHeader = req.headers.get("Authorization");
  if (!CRON_SECRET || authHeader !== `Bearer ${CRON_SECRET}`) {
    return withCors({ error: "Unauthorized" }, { status: 401 });
  }

  const supabase = getServiceClient();
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
    discrepancies: count > 0 ? discrepancies : undefined,
  });
});
