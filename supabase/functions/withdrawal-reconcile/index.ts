import { withCors } from "../_shared/cors.ts";
import { getServiceClient } from "../_shared/db.ts";
import { getPlatformPaymentSettings } from "../_shared/psp/platformSettings.ts";
import { fetchTransferStatus } from "../_shared/psp/registry.ts";
import { applyWithdrawalStatus } from "../_shared/psp/withdrawalFinalize.ts";

const CRON_SECRET = Deno.env.get("CRON_SECRET") ?? "";
const STUCK_AFTER_MINUTES = Number(Deno.env.get("WITHDRAWAL_RECONCILE_MINUTES") ?? "15");
const BATCH_LIMIT = Number(Deno.env.get("WITHDRAWAL_RECONCILE_BATCH") ?? "25");

type WithdrawalRow = {
  id: string;
  provider: string | null;
  provider_ref: string | null;
  idempotency_key: string;
  status: string;
  created_at: string;
};

Deno.serve(async (req) => {
  if (req.method !== "POST") return withCors({ error: "Method not allowed" }, { status: 405 });

  const authHeader = req.headers.get("Authorization");
  if (!CRON_SECRET || authHeader !== `Bearer ${CRON_SECRET}`) {
    return withCors({ error: "Unauthorized" }, { status: 401 });
  }

  const supabase = getServiceClient();
  const platform = await getPlatformPaymentSettings(supabase);
  const cutoff = new Date(Date.now() - STUCK_AFTER_MINUTES * 60 * 1000).toISOString();

  const { data: rows, error } = await supabase
    .from("transactions")
    .select("id, provider, provider_ref, idempotency_key, status, created_at")
    .eq("type", "withdrawal")
    .eq("currency", "NGN")
    .in("status", ["pending", "processing"])
    .lt("created_at", cutoff)
    .order("created_at", { ascending: true })
    .limit(BATCH_LIMIT);

  if (error) {
    return withCors({ error: "Failed to load withdrawals", detail: error.message }, { status: 500 });
  }

  const results: Array<{ id: string; outcome: string }> = [];

  for (const row of (rows ?? []) as WithdrawalRow[]) {
    const providerId = row.provider ?? platform.disbursementProviderId;
    const reference = row.idempotency_key;

    try {
      const status = await fetchTransferStatus(providerId, reference, platform.pspEnv);
      const outcome = await applyWithdrawalStatus(supabase, row, status, "reconcile");
      results.push({ id: row.id, outcome });
    } catch (err) {
      results.push({ id: row.id, outcome: `error:${String(err)}` });
    }
  }

  return withCors({
    ok: true,
    reconciled_at: new Date().toISOString(),
    scanned: rows?.length ?? 0,
    stuck_after_minutes: STUCK_AFTER_MINUTES,
    results,
  });
});
