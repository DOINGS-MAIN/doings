import type { SupabaseClient } from "https://esm.sh/@supabase/supabase-js@2.49.8";
import { logPspEvent } from "./pspEvents.ts";
import type { TransferStatusOutcome } from "./types.ts";
import { finalizeRpcNames } from "../sell.ts";

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

  const terminal = outcome.normalized === "terminal_success" || outcome.normalized === "terminal_failure";
  let metadata: Record<string, unknown> = {};
  if (terminal) {
    const { data: row } = await supabase
      .from("transactions")
      .select("metadata")
      .eq("id", txn.id)
      .maybeSingle();
    metadata = (row?.metadata as Record<string, unknown> | null) ?? {};
  }
  // Bundle sales finalise through their own RPCs (treasury legs); other withdrawals are unchanged.
  const rpc = finalizeRpcNames(metadata.kind as string | undefined);

  if (outcome.normalized === "terminal_success") {
    const { error } = await supabase.rpc(rpc.complete, { p_transaction_id: txn.id });
    if (error) throw error;
    return "completed";
  }

  if (outcome.normalized === "terminal_failure") {
    if (outcome.message) {
      await supabase
        .from("transactions")
        .update({
          metadata: { ...metadata, failure_reason: outcome.message, psp_status: outcome.providerStatus },
          updated_at: new Date().toISOString(),
        })
        .eq("id", txn.id);
    }
    const { error } = await supabase.rpc(rpc.fail, { p_transaction_id: txn.id });
    if (error) throw error;
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
