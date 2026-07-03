import type { SupabaseClient } from "https://esm.sh/@supabase/supabase-js@2.49.8";
import { applyWithdrawalStatus } from "./psp/withdrawalFinalize.ts";
import { mapFlutterwaveTransferStatus, mapNombaTransferStatus } from "./psp/pspStatus.ts";
import { creditInboundDeposit } from "./walletInboundCredit.ts";
import { markWebhookProcessed } from "./webhook.ts";

type WebhookRow = {
  id: string;
  provider: string;
  event_type: string | null;
  payload: Record<string, unknown>;
};

function pickString(obj: Record<string, unknown>, keys: string[]): string {
  for (const k of keys) {
    const v = obj[k];
    if (v != null && String(v).trim()) return String(v).trim();
  }
  return "";
}

export async function reprocessWebhookLog(
  supabase: SupabaseClient,
  row: WebhookRow,
): Promise<{ ok: boolean; message: string }> {
  const provider = row.provider.toLowerCase();
  const payload = row.payload;

  try {
    if (provider === "monnify") {
      return await reprocessMonnify(supabase, row.id, payload);
    }
    if (provider === "nomba") {
      return await reprocessNomba(supabase, row.id, payload);
    }
    if (provider === "flutterwave") {
      return await reprocessFlutterwave(supabase, row.id, payload);
    }
    return { ok: false, message: `Reprocess not implemented for provider: ${provider}` };
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err);
    await markWebhookProcessed(row.id, message);
    return { ok: false, message };
  }
}

async function reprocessMonnify(
  supabase: SupabaseClient,
  logId: string,
  payload: Record<string, unknown>,
) {
  const eventType = (payload.eventType as string) ?? "";
  const eventData = (payload.eventData as Record<string, unknown>) ?? {};

  if (eventType === "SUCCESSFUL_DISBURSEMENT" || eventType === "FAILED_DISBURSEMENT") {
    const ref = pickString(eventData, ["transactionReference", "paymentReference"]);
    if (!ref) {
      await markWebhookProcessed(logId, "Missing disbursement reference");
      return { ok: false, message: "Missing disbursement reference" };
    }

    const { data: txn } = await supabase
      .from("transactions")
      .select("id, provider, provider_ref, idempotency_key, status")
      .eq("type", "withdrawal")
      .in("status", ["pending", "processing"])
      .or(`provider_ref.eq.${ref},idempotency_key.eq.${ref}`)
      .maybeSingle();

    if (txn?.id) {
      await applyWithdrawalStatus(
        supabase,
        txn,
        {
          normalized: eventType === "SUCCESSFUL_DISBURSEMENT" ? "terminal_success" : "terminal_failure",
          providerStatus: eventType,
          providerRef: ref,
        },
        "webhook",
      );
    }
    await markWebhookProcessed(logId);
    return { ok: true, message: txn?.id ? "Withdrawal updated" : "No matching in-flight withdrawal" };
  }

  if (eventType !== "SUCCESSFUL_TRANSACTION" || eventData.paymentStatus !== "PAID") {
    await markWebhookProcessed(logId);
    return { ok: true, message: "Skipped non-deposit event" };
  }

  const accountReference = pickString(eventData, ["accountReference"]);
  const transactionReference = pickString(eventData, ["transactionReference"]);
  if (!accountReference || !transactionReference) {
    await markWebhookProcessed(logId, "Missing accountReference or transactionReference");
    return { ok: false, message: "Invalid Monnify deposit payload" };
  }

  const { data: reserved } = await supabase
    .from("reserved_accounts")
    .select("user_id, wallet_id, account_name")
    .eq("account_reference", accountReference)
    .eq("provider_id", "monnify")
    .maybeSingle();

  if (!reserved) {
    await markWebhookProcessed(logId, "Reserved account not found");
    return { ok: false, message: "Reserved account not found" };
  }

  const amountPaid = Number(eventData.amountPaid ?? 0);
  const payerName = pickString(eventData, ["customerName"]) ||
    ((eventData.paymentSourceInformation as { accountName?: string }[])?.[0]?.accountName ?? "");

  const result = await creditInboundDeposit(supabase, {
    walletId: reserved.wallet_id,
    userId: reserved.user_id,
    providerId: "monnify",
    amountNaira: amountPaid,
    paymentReference: transactionReference,
    transactionReference,
    payerName,
    metadata: { monnify_reprocess: true },
  });

  if (result.kind === "error") {
    await markWebhookProcessed(logId, result.message);
    return { ok: false, message: result.message };
  }
  if (result.kind === "rejected_aml") {
    await markWebhookProcessed(logId, result.reason);
    return { ok: false, message: result.reason };
  }

  await markWebhookProcessed(logId);
  return { ok: true, message: result.kind === "duplicate" ? "Already credited (duplicate)" : "Deposit credited" };
}

async function reprocessNomba(
  supabase: SupabaseClient,
  logId: string,
  payload: Record<string, unknown>,
) {
  const eventType = pickString(payload, ["eventType", "event", "type"]);
  const data = (payload.data || payload.eventData || payload) as Record<string, unknown>;

  const transferEvents = new Set([
    "transfer_success", "TRANSFER_SUCCESS", "transfer_failed", "TRANSFER_FAILED",
    "transfer_completed", "TRANSFER_COMPLETED",
  ]);

  if (eventType && transferEvents.has(eventType)) {
    const ref = pickString(data, ["merchantTxRef", "orderReference", "reference", "transactionRef"]);
    if (ref) {
      const { data: txn } = await supabase
        .from("transactions")
        .select("id, provider, provider_ref, idempotency_key, status")
        .eq("type", "withdrawal")
        .in("status", ["pending", "processing"])
        .or(`idempotency_key.eq.${ref},provider_ref.eq.${ref}`)
        .maybeSingle();

      if (txn?.id) {
        const providerStatus = pickString(data, ["status", "transferStatus"]).toUpperCase() ||
          (eventType.toLowerCase().includes("fail") ? "FAILED" : "SUCCESS");
        const mapped = mapNombaTransferStatus(providerStatus);
        const normalized = mapped.cls === "terminal_success"
          ? "terminal_success"
          : mapped.cls === "terminal_failure"
          ? "terminal_failure"
          : "non_terminal";

        await applyWithdrawalStatus(supabase, txn, { normalized, providerStatus, providerRef: ref }, "webhook");
      }
    }
    await markWebhookProcessed(logId);
    return { ok: true, message: "Transfer webhook reprocessed" };
  }

  const accountNumber = pickString(data, ["accountNumber", "beneficiaryAccountNumber", "creditAccount"]);
  const amount = Number(pickString(data, ["amount", "transactionAmount"]) || data.amount || 0);
  const reference = pickString(data, ["transactionId", "orderReference", "reference", "id"]);

  if (!accountNumber || !reference || amount <= 0) {
    await markWebhookProcessed(logId, "Not a recognized Nomba inbound payload");
    return { ok: false, message: "Not a recognized Nomba inbound payload" };
  }

  const { data: reserved } = await supabase
    .from("reserved_accounts")
    .select("user_id, wallet_id, account_name, account_number")
    .eq("account_number", accountNumber)
    .eq("provider_id", "nomba")
    .maybeSingle();

  if (!reserved) {
    await markWebhookProcessed(logId, "Nomba reserved account not found");
    return { ok: false, message: "Nomba reserved account not found" };
  }

  const payerName = pickString(data, ["senderName", "originatorName", "payerName", "accountName"]);

  const result = await creditInboundDeposit(supabase, {
    walletId: reserved.wallet_id,
    userId: reserved.user_id,
    providerId: "nomba",
    amountNaira: amount,
    paymentReference: reference,
    transactionReference: reference,
    payerName,
    skipNameCheckEnv: "NOMBA_WEBHOOK_SKIP_PAYER_NAME_CHECK",
    metadata: { nomba_reprocess: true, event_type: eventType },
  });

  if (result.kind === "error") {
    await markWebhookProcessed(logId, result.message);
    return { ok: false, message: result.message };
  }
  if (result.kind === "rejected_aml") {
    await markWebhookProcessed(logId, result.reason);
    return { ok: false, message: result.reason };
  }

  await markWebhookProcessed(logId);
  return { ok: true, message: result.kind === "duplicate" ? "Already credited (duplicate)" : "Deposit credited" };
}

async function reprocessFlutterwave(
  supabase: SupabaseClient,
  logId: string,
  payload: Record<string, unknown>,
) {
  const eventType = pickString(payload, ["event", "event.type", "event_type"]);
  const data = (payload.data || {}) as Record<string, unknown>;
  const meta = (payload.meta_data || payload.meta || {}) as Record<string, unknown>;
  const merged = { ...data, ...meta };
  const normalizedEvent = eventType.toLowerCase();

  if (normalizedEvent.includes("transfer")) {
    const ref = pickString(merged, ["reference", "tx_ref", "transfer_reference"]);
    if (ref) {
      const { data: txn } = await supabase
        .from("transactions")
        .select("id, provider, provider_ref, idempotency_key, status")
        .eq("type", "withdrawal")
        .in("status", ["pending", "processing"])
        .or(`idempotency_key.eq.${ref},provider_ref.eq.${ref}`)
        .maybeSingle();

      if (txn?.id) {
        const providerStatus = pickString(merged, ["status"]).toUpperCase() ||
          (normalizedEvent.includes("fail") ? "FAILED" : "SUCCESSFUL");
        const mapped = mapFlutterwaveTransferStatus(providerStatus);
        const normalized = mapped.cls === "terminal_success"
          ? "terminal_success"
          : mapped.cls === "terminal_failure"
          ? "terminal_failure"
          : "non_terminal";
        await applyWithdrawalStatus(supabase, txn, { normalized, providerStatus, providerRef: ref }, "webhook");
      }
    }
    await markWebhookProcessed(logId);
    return { ok: true, message: "Transfer webhook reprocessed" };
  }

  const txRef = pickString(merged, ["tx_ref", "reference"]);
  const accountNumber = pickString(merged, ["account_number"]);
  const amount = pickNumber(merged, ["amount", "charged_amount"]);
  const paymentReference = pickString(merged, ["flw_ref", "tx_ref", "id"]) || txRef;

  let reserved: { user_id: string; wallet_id: string } | null = null;
  if (txRef) {
    const { data: row } = await supabase
      .from("reserved_accounts")
      .select("user_id, wallet_id")
      .eq("provider_id", "flutterwave")
      .eq("account_reference", txRef)
      .maybeSingle();
    reserved = row;
  }
  if (!reserved && accountNumber) {
    const { data: row } = await supabase
      .from("reserved_accounts")
      .select("user_id, wallet_id")
      .eq("provider_id", "flutterwave")
      .eq("account_number", accountNumber)
      .maybeSingle();
    reserved = row;
  }

  if (!reserved || !paymentReference || amount <= 0) {
    await markWebhookProcessed(logId, "Not a recognized Flutterwave inbound payload");
    return { ok: false, message: "Not a recognized Flutterwave inbound payload" };
  }

  const payerName = pickString(merged, ["originatorname", "originator_name", "sender_name"]);
  const result = await creditInboundDeposit(supabase, {
    walletId: reserved.wallet_id,
    userId: reserved.user_id,
    providerId: "flutterwave",
    amountNaira: amount,
    paymentReference,
    transactionReference: paymentReference,
    payerName,
    skipNameCheckEnv: "FLUTTERWAVE_WEBHOOK_SKIP_PAYER_NAME_CHECK",
    metadata: { flutterwave_reprocess: true, event_type: eventType },
  });

  if (result.kind === "error") {
    await markWebhookProcessed(logId, result.message);
    return { ok: false, message: result.message };
  }
  if (result.kind === "rejected_aml") {
    await markWebhookProcessed(logId, result.reason);
    return { ok: false, message: result.reason };
  }

  await markWebhookProcessed(logId);
  return { ok: true, message: result.kind === "duplicate" ? "Already credited (duplicate)" : "Deposit credited" };
}

function pickNumber(obj: Record<string, unknown>, keys: string[]): number {
  for (const k of keys) {
    const v = obj[k];
    if (v != null && !Number.isNaN(Number(v))) return Number(v);
  }
  return 0;
}
