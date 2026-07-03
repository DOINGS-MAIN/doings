import { corsHeaders, withCors } from "../_shared/cors.ts";
import { formatSupabaseError } from "../_shared/formatError.ts";
import { getServiceClient } from "../_shared/db.ts";
import { verifyFlutterwaveWebhook } from "../_shared/flutterwaveWebhookSignature.ts";
import { insertWebhookLog, markWebhookProcessed } from "../_shared/webhook.ts";
import { creditInboundDeposit } from "../_shared/walletInboundCredit.ts";
import { applyWithdrawalStatus } from "../_shared/psp/withdrawalFinalize.ts";
import { mapFlutterwaveTransferStatus } from "../_shared/psp/pspStatus.ts";

function pickString(obj: Record<string, unknown>, keys: string[]): string {
  for (const k of keys) {
    const v = obj[k];
    if (v != null && String(v).trim()) return String(v).trim();
  }
  return "";
}

function isFlutterwaveBankTransferPayment(paymentType: string): boolean {
  const normalized = paymentType.toLowerCase().replace(/[\s_-]/g, "");
  if (!normalized) return true;
  return (
    normalized === "banktransfer" ||
    normalized === "account" ||
    normalized === "bank" ||
    normalized.includes("banktransfer")
  );
}

function pickNumber(obj: Record<string, unknown>, keys: string[]): number {
  for (const k of keys) {
    const v = obj[k];
    if (v != null && !Number.isNaN(Number(v))) return Number(v);
  }
  return 0;
}

Deno.serve(async (req) => {
  if (req.method === "OPTIONS") return new Response("ok", { headers: corsHeaders });
  if (req.method === "GET" || req.method === "HEAD") {
    return withCors({ ok: true, service: "webhook-flutterwave" });
  }
  if (req.method !== "POST") return withCors({ error: "Method not allowed" }, { status: 405 });

  const raw = await req.text();
  if (!raw.trim()) {
    return withCors({ ok: true, message: "ready" });
  }

  const secretHash = Deno.env.get("FLUTTERWAVE_WEBHOOK_SECRET_HASH")?.trim() ?? "";
  const secretKey = Deno.env.get("FLUTTERWAVE_SECRET_KEY")?.trim() ?? "";
  const verifHash = req.headers.get("verif-hash");
  const flutterwaveSignature = req.headers.get("flutterwave-signature");

  let payload: Record<string, unknown>;
  try {
    payload = JSON.parse(raw) as Record<string, unknown>;
  } catch {
    return withCors({ error: "Invalid JSON payload" }, { status: 400 });
  }

  const eventType = pickString(payload, ["event", "event.type", "event_type"]);
  const data = (payload.data || {}) as Record<string, unknown>;
  const meta = (payload.meta_data || payload.meta || {}) as Record<string, unknown>;
  const merged = { ...data, ...meta };
  const idempotencyKey = pickString(merged, ["flw_ref", "tx_ref", "reference", "id"]);

  const signatureValid = await verifyFlutterwaveWebhook({
    rawBody: raw,
    verifHash,
    flutterwaveSignature,
    secretHash,
    secretKey,
  });

  let logId = "";
  try {
    const logInsert = await insertWebhookLog({
      provider: "flutterwave",
      payload,
      headers: Object.fromEntries(req.headers.entries()),
      signature: verifHash || flutterwaveSignature,
      signatureValid,
      idempotencyKey: idempotencyKey || null,
      eventType,
    });
    logId = logInsert.id;
    if (logInsert.duplicate && logInsert.alreadyProcessed) {
      return withCors({ ok: true, duplicate: true });
    }

    if ((secretHash || secretKey) && !signatureValid) {
      await markWebhookProcessed(logId, "Invalid signature");
      return withCors({ error: "Invalid signature" }, { status: 401 });
    }

    const supabase = getServiceClient();
    const normalizedEvent = eventType.toLowerCase();

    // Outbound transfers (withdrawals)
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
          const providerStatus = pickString(merged, ["status", "transfer_status"]).toUpperCase() ||
            (normalizedEvent.includes("fail") ? "FAILED" : "SUCCESSFUL");
          const failureMessage = pickString(merged, ["complete_message", "message"]);
          const mapped = mapFlutterwaveTransferStatus(providerStatus);
          const normalized = mapped.cls === "terminal_success"
            ? "terminal_success"
            : mapped.cls === "terminal_failure"
            ? "terminal_failure"
            : "non_terminal";

          await applyWithdrawalStatus(
            supabase,
            txn,
            {
              normalized,
              providerStatus,
              providerRef: ref,
              message: failureMessage || undefined,
            },
            "webhook",
          );
        }
      }
      await markWebhookProcessed(logId);
      return withCors({ ok: true, handled: "withdrawal" });
    }

    // Inbound bank transfer to virtual account
    const isCharge = normalizedEvent.includes("charge");
    const paymentType = pickString(merged, ["payment_type"]);
    const status = pickString(merged, ["status"]).toLowerCase();

    if (
      !isCharge ||
      (paymentType && !isFlutterwaveBankTransferPayment(paymentType)) ||
      (status && status !== "successful")
    ) {
      await markWebhookProcessed(logId);
      return withCors({ ok: true, skipped: true, eventType });
    }

    const txRef = pickString(merged, ["tx_ref", "reference"]);
    const accountNumber = pickString(merged, [
      "account_number",
      "bankaccountnumber",
      "destination_account_number",
    ]);
    const amount = pickNumber(merged, ["amount", "charged_amount", "settled_amount"]);
    const paymentReference = pickString(merged, ["flw_ref", "tx_ref", "id"]) || txRef;
    const payerName = pickString(merged, ["originatorname", "originator_name", "sender_name", "customer_name"]);

    let va: { wallet_id: string; user_id: string } | null = null;

    if (txRef) {
      const { data: byRef } = await supabase
        .from("reserved_accounts")
        .select("wallet_id, user_id")
        .eq("provider_id", "flutterwave")
        .eq("account_reference", txRef)
        .maybeSingle();
      va = byRef;
    }

    if (!va?.wallet_id && accountNumber) {
      const { data: byAcct } = await supabase
        .from("reserved_accounts")
        .select("wallet_id, user_id")
        .eq("provider_id", "flutterwave")
        .eq("account_number", accountNumber)
        .maybeSingle();
      va = byAcct;
    }

    if (!va?.wallet_id || !va?.user_id) {
      await markWebhookProcessed(logId, `Unknown Flutterwave VA: ${txRef || accountNumber}`);
      return withCors({ ok: true, ignored: true, reason: "unknown_va" });
    }

    if (!paymentReference || amount <= 0) {
      await markWebhookProcessed(logId, "Missing inbound fields");
      return withCors({ ok: true, ignored: true, reason: "missing_fields" });
    }

    const result = await creditInboundDeposit(supabase, {
      walletId: va.wallet_id,
      userId: va.user_id,
      amountNaira: amount,
      paymentReference,
      transactionReference: paymentReference,
      providerId: "flutterwave",
      payerName,
      metadata: {
        event_type: eventType,
        flw_ref: paymentReference,
        tx_ref: txRef || null,
      },
      skipNameCheckEnv: "FLUTTERWAVE_WEBHOOK_SKIP_PAYER_NAME_CHECK",
    });

    if (result.kind === "error") {
      await markWebhookProcessed(logId, result.message);
      return withCors({ error: result.message }, { status: 500 });
    }

    if (result.kind === "rejected_aml") {
      await markWebhookProcessed(logId, result.reason);
      return withCors({ error: result.reason }, { status: 403 });
    }

    await markWebhookProcessed(logId);
    return withCors({ ok: true, result: result.kind });
  } catch (error) {
    const message = formatSupabaseError(error);
    if (logId) await markWebhookProcessed(logId, message);
    return withCors({ error: "Failed to process webhook", detail: message }, { status: 500 });
  }
});
