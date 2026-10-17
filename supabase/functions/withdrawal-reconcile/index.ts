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
  metadata?: Record<string, unknown> | null;
};

const REVIEW_AFTER_MS = 60 * 60 * 1000;

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
    .select("id, provider, provider_ref, idempotency_key, status, created_at, metadata")
    .eq("type", "withdrawal")
    .eq("currency", "NGN")
    .or("provider.is.null,provider.neq.blockradar") // USDC bundle sales hold NGN but pay out via Blockradar
    .in("status", ["pending", "processing"])
    .lt("created_at", cutoff)
    // Least recently checked first, so rows that stay unresolved can't starve newer ones.
    .order("updated_at", { ascending: true })
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
    // Still open: rotate it to the back of the queue, and flag it for admins after an hour (never
    // failed automatically — the provider may have paid).
    const { data: after } = await supabase.from("transactions").select("status, metadata").eq("id", row.id).maybeSingle();
    if (after && (after.status === "pending" || after.status === "processing")) {
      const metadata = (after.metadata as Record<string, unknown> | null) ?? {};
      const stale = Date.now() - new Date(row.created_at).getTime() > REVIEW_AFTER_MS;
      // Only touch it while it's still open, and merge the flag rather than rewriting the metadata,
      // so an admin's check or resolution written meanwhile isn't lost.
      await supabase.from("transactions")
        .update({ updated_at: new Date().toISOString() })
        .eq("id", row.id)
        .in("status", ["pending", "processing"]);
      if (stale && !metadata.needs_review) {
        await supabase.rpc("merge_transaction_metadata", { p_transaction_id: row.id, p_patch: { needs_review: true } });
      }
    }
  }

  // Blockradar payouts (USDC withdrawals and USDC bundle sales) settle by webhook only. Ones still
  // open after 30 min are flagged for admin review — never failed automatically, since the USDC
  // may already have been sent.
  const usdcCutoff = new Date(Date.now() - 30 * 60 * 1000).toISOString();
  const { data: stuckUsdc } = await supabase
    .from("transactions")
    .select("id, metadata")
    .eq("type", "withdrawal")
    .eq("provider", "blockradar")
    .in("status", ["pending", "processing"])
    .lt("created_at", usdcCutoff)
    .is("metadata->needs_review", null)
    .order("created_at", { ascending: true })
    .limit(BATCH_LIMIT);
  let flagged = 0;
  for (const row of stuckUsdc ?? []) {
    const metadata = (row.metadata as Record<string, unknown> | null) ?? {};
    if (metadata.needs_review) continue;
    await supabase.rpc("merge_transaction_metadata", { p_transaction_id: row.id, p_patch: { needs_review: true } });
    flagged += 1;
  }

  return withCors({
    ok: true,
    blockradar_flagged: flagged,
    reconciled_at: new Date().toISOString(),
    scanned: rows?.length ?? 0,
    stuck_after_minutes: STUCK_AFTER_MINUTES,
    results,
  });
});
