import { corsHeaders, withCors } from "../_shared/cors.ts";
import { getServiceClient } from "../_shared/db.ts";
import { insertWebhookLog, markWebhookProcessed } from "../_shared/webhook.ts";
import { creditInboundDeposit } from "../_shared/walletInboundCredit.ts";
import { applyWithdrawalStatus } from "../_shared/psp/withdrawalFinalize.ts";
import { mapNombaTransferStatus } from "../_shared/psp/pspStatus.ts";
import { verifyNombaWebhookSignature } from "../_shared/nombaWebhookSignature.ts";

function pickString(obj: Record<string, unknown>, keys: string[]): string {
  for (const k of keys) {
    const v = obj[k];
    if (v != null && String(v).trim()) return String(v).trim();
  }
  return "";
}

function pickNumber(obj: Record<string, unknown>, keys: string[]): number {
  for (const k of keys) {
    const v = obj[k];
    if (v != null && !Number.isNaN(Number(v))) return Number(v);
  }
  return 0;
}

function nombaEventData(data: Record<string, unknown>): Record<string, unknown> {
  const transaction = (data.transaction || {}) as Record<string, unknown>;
  const customer = (data.customer || {}) as Record<string, unknown>;
  const order = (data.order || {}) as Record<string, unknown>;
  return { ...data, ...transaction, ...customer, ...order };
}

function isNombaPayoutFailure(eventType: string): boolean {
  const t = eventType.toLowerCase();
  return t.includes("fail") || t.includes("refund");
}

Deno.serve(async (req) => {
  if (req.method === "OPTIONS") return new Response("ok", { headers: corsHeaders });
  if (req.method === "GET" || req.method === "HEAD") {
    return withCors({ ok: true, service: "webhook-nomba" });
  }
  if (req.method !== "POST") return withCors({ error: "Method not allowed" }, { status: 405 });

  const raw = await req.text();

  const webhookSecret = Deno.env.get("NOMBA_WEBHOOK_SECRET")?.trim() ?? "";
  const signature = req.headers.get("nomba-signature") ?? req.headers.get("x-nomba-signature");
  const timestamp = req.headers.get("nomba-timestamp");

  // Nomba dashboard URL validation may POST an empty body without signature headers.
  if (!raw.trim()) {
    return withCors({ ok: true, message: "ready" });
  }

  let payload: Record<string, unknown>;
  try {
    payload = JSON.parse(raw) as Record<string, unknown>;
  } catch {
    return withCors({ error: "Invalid JSON payload" }, { status: 400 });
  }

  const eventType = pickString(payload, ["eventType", "event", "type", "event_type"]);
  const data = (payload.data || payload.eventData || payload) as Record<string, unknown>;
  const fields = nombaEventData(data);
  const idempotencyKey = pickString(fields, ["orderReference", "merchantTxRef", "reference", "transactionId", "id"]);

  const signatureValid = webhookSecret
    ? await verifyNombaWebhookSignature({ rawBody: raw, signature, timestamp, secret: webhookSecret })
    : null;

  let logId = "";
  try {
    const logInsert = await insertWebhookLog({
      provider: "nomba",
      payload,
      headers: Object.fromEntries(req.headers.entries()),
      signature,
      signatureValid: signatureValid ?? false,
      idempotencyKey: idempotencyKey || null,
      eventType,
    });
    logId = logInsert.id;
    if (logInsert.duplicate && logInsert.alreadyProcessed) {
      return withCors({ ok: true, duplicate: true });
    }

    if (webhookSecret) {
      if (!signature?.trim()) {
        if (!eventType) {
          await markWebhookProcessed(logId, "Validation probe (no signature)");
          return withCors({ ok: true, message: "ready" });
        }
        await markWebhookProcessed(logId, "Missing nomba-signature header");
        return withCors({ error: "Missing signature" }, { status: 401 });
      }
      if (signatureValid === false) {
        await markWebhookProcessed(logId, "Invalid signature");
        return withCors({ error: "Invalid signature" }, { status: 401 });
      }
    }

    const supabase = getServiceClient();

    // Outbound bank transfers (withdrawals)
    const payoutEvents = new Set([
      "payout_success",
      "payout_failed",
      "payout_refund",
      "PAYOUT_SUCCESS",
      "PAYOUT_FAILED",
      "PAYOUT_REFUND",
      "transfer_success",
      "TRANSFER_SUCCESS",
      "transfer_failed",
      "TRANSFER_FAILED",
      "transfer_completed",
      "TRANSFER_COMPLETED",
    ]);

    if (eventType && payoutEvents.has(eventType)) {
      const ref = pickString(fields, ["merchantTxRef", "orderReference", "reference", "transactionRef", "transactionId"]);
      if (ref) {
        const { data: txn } = await supabase
          .from("transactions")
          .select("id, provider, provider_ref, idempotency_key, status")
          .eq("type", "withdrawal")
          .in("status", ["pending", "processing"])
          .or(`idempotency_key.eq.${ref},provider_ref.eq.${ref}`)
          .maybeSingle();

        if (txn?.id) {
          const providerStatus = pickString(fields, ["status", "transferStatus", "responseCode"]).toUpperCase() ||
            (isNombaPayoutFailure(eventType) ? "FAILED" : "SUCCESS");
          const mapped = mapNombaTransferStatus(providerStatus);
          const normalized = mapped.cls === "terminal_success"
            ? "terminal_success"
            : mapped.cls === "terminal_failure"
            ? "terminal_failure"
            : "non_terminal";

          await applyWithdrawalStatus(
            supabase,
            txn,
            { normalized, providerStatus, providerRef: ref },
            "webhook",
          );
        }
      }
      await markWebhookProcessed(logId);
      return withCors({ ok: true, handled: "withdrawal" });
    }

    // Inbound VA credit
    const creditEvents = new Set(["payment_success", "PAYMENT_SUCCESS", "credit", "successful", ""]);
    if (eventType && !creditEvents.has(eventType)) {
      await markWebhookProcessed(logId);
      return withCors({ ok: true, skipped: true, eventType });
    }

    const accountNumber = pickString(fields, [
      "aliasAccountNumber",
      "bankAccountNumber",
      "accountNumber",
      "beneficiaryAccountNumber",
      "destinationAccountNumber",
    ]);
    const amount = pickNumber(fields, ["amount", "transactionAmount", "settledAmount", "creditAmount"]);
    const paymentReference = pickString(fields, [
      "orderReference",
      "merchantTxRef",
      "reference",
      "transactionId",
      "aliasAccountReference",
      "id",
    ]);
    const transactionReference = pickString(fields, ["transactionId", "sessionId", "rrn", "id"]) || paymentReference;
    const payerName = pickString(fields, ["senderName", "originatorAccountName", "payerName", "customerName"]);

    if (!accountNumber || !paymentReference || amount <= 0) {
      await markWebhookProcessed(logId, "Missing inbound fields");
      return withCors({ ok: true, ignored: true, reason: "missing_fields" });
    }

    const { data: va } = await supabase
      .from("reserved_accounts")
      .select("wallet_id, user_id")
      .eq("provider_id", "nomba")
      .eq("account_number", accountNumber)
      .maybeSingle();

    if (!va?.wallet_id || !va?.user_id) {
      await markWebhookProcessed(logId, `Unknown Nomba VA: ${accountNumber}`);
      return withCors({ ok: true, ignored: true, reason: "unknown_va" });
    }

    const result = await creditInboundDeposit(supabase, {
      walletId: va.wallet_id,
      userId: va.user_id,
      amountNaira: amount,
      paymentReference,
      transactionReference,
      providerId: "nomba",
      payerName,
      metadata: { nomba_webhook: payload, event_type: eventType },
      skipNameCheckEnv: "NOMBA_WEBHOOK_SKIP_PAYER_NAME_CHECK",
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
    if (logId) await markWebhookProcessed(logId, String(error));
    return withCors({ error: "Failed to process webhook" }, { status: 500 });
  }
});
