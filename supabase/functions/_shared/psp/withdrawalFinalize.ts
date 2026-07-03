import type { SupabaseClient } from "https://esm.sh/@supabase/supabase-js@2.49.8";
import { logPspEvent } from "./pspEvents.ts";
import type { TransferStatusOutcome } from "./types.ts";

type WithdrawalTxn = {
  id: string;
  provider: string | null;
  idempotency_key: string;
  provider_ref: string | null;
  status: string;
};

export async function applyWithdrawalStatus(
  supabase: SupabaseClient,
  txn: WithdrawalTxn,
  outcome: TransferStatusOutcome,
  source: "webhook" | "reconcile" | "submit",
): Promise<"completed" | "failed" | "processing" | "unchanged"> {
  const providerId = txn.provider ?? "monnify";
  const reference = txn.idempotency_key;

  await logPspEvent(supabase, {
    transactionId: txn.id,
    providerId,
    direction: "outbound",
    eventType: source === "webhook" ? "webhook_received" : "status_poll",
    status: outcome.normalized,
    providerStatus: outcome.providerStatus,
    reference,
    providerRef: outcome.providerRef ?? txn.provider_ref,
    responseSummary: outcome as unknown as Record<string, unknown>,
    errorMessage: outcome.message ?? null,
  });

  if (outcome.normalized === "terminal_success") {
    await supabase.rpc("complete_withdrawal", { p_transaction_id: txn.id });
    return "completed";
  }

  if (outcome.normalized === "terminal_failure") {
    if (outcome.message) {
      const { data: row } = await supabase
        .from("transactions")
        .select("metadata")
        .eq("id", txn.id)
        .maybeSingle();
      const metadata = (row?.metadata as Record<string, unknown> | null) ?? {};
      await supabase
        .from("transactions")
        .update({
          metadata: { ...metadata, failure_reason: outcome.message, psp_status: outcome.providerStatus },
          updated_at: new Date().toISOString(),
        })
        .eq("id", txn.id);
    }
    await supabase.rpc("fail_withdrawal", { p_transaction_id: txn.id });
    return "failed";
  }

  if (txn.status === "pending") {
    await supabase
      .from("transactions")
      .update({ status: "processing", updated_at: new Date().toISOString() })
      .eq("id", txn.id)
      .in("status", ["pending"]);
    return "processing";
  }

  return "unchanged";
}
