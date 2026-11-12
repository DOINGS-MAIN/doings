import { corsHeaders, withCors } from "../_shared/cors.ts";
import { formatSupabaseError } from "../_shared/formatError.ts";
import { getServiceClient } from "../_shared/db.ts";
import { verifyFlutterwaveWebhook } from "../_shared/flutterwaveWebhookSignature.ts";
import { insertWebhookLog, markWebhookProcessed, safeProviderRef } from "../_shared/webhook.ts";
import { applyWithdrawalStatus } from "../_shared/psp/withdrawalFinalize.ts";
import { mapFlutterwaveTransferStatus } from "../_shared/psp/pspStatus.ts";
import { BUNDLE_TX_REF_PREFIX, settleNgnBundleOrder } from "../_shared/bundles.ts";

function pickString(obj: Record<string, unknown>, keys: string[]): string {
  for (const k of keys) {
    const v = obj[k];
    if (v != null && String(v).trim()) return String(v).trim();
  }
  return "";
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
  // Only `data` is Flutterwave's own account of the transaction. `meta_data` is whatever the payer's
  // checkout sent along, so it is never read: it used to override the reference, amount and status.
  const data = (payload.data || {}) as Record<string, unknown>;
  const idempotencyKey = pickString(data, ["flw_ref", "tx_ref", "reference", "id"]);

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

    // Fail closed: without a configured secret every request would pass verification.
    if (!secretHash && !secretKey) {
      await markWebhookProcessed(logId, "Webhook secret not configured");
      return withCors({ error: "Webhook secret not configured" }, { status: 500 });
    }
    if (!signatureValid) {
      await markWebhookProcessed(logId, "Invalid signature");
      return withCors({ error: "Invalid signature" }, { status: 401 });
    }

    const supabase = getServiceClient();
    const normalizedEvent = eventType.toLowerCase();

    // Outbound transfers (withdrawals)
    if (normalizedEvent.includes("transfer")) {
      const ref = safeProviderRef(pickString(data, ["reference", "tx_ref", "transfer_reference"]));
      if (ref) {
        const { data: txn } = await supabase
          .from("transactions")
          .select("id, provider, provider_ref, idempotency_key, status")
          .eq("type", "withdrawal")
          .eq("provider", "flutterwave")
          .in("status", ["pending", "processing"])
          .or(`idempotency_key.eq.${ref},provider_ref.eq.${ref}`)
          .maybeSingle();

        if (txn?.id) {
          const providerStatus = pickString(data, ["status", "transfer_status"]).toUpperCase() ||
            (normalizedEvent.includes("fail") ? "FAILED" : "SUCCESSFUL");
          const failureMessage = pickString(data, ["complete_message", "message"]);
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

    // Bundle checkout (hosted payment): any payment method. Credited only after Flutterwave's API
    // confirms the transaction (settleNgnBundleOrder), never from this payload's amount.
    const bundleTxRef = pickString(data, ["tx_ref"]);
    if (normalizedEvent.includes("charge") && bundleTxRef.startsWith(BUNDLE_TX_REF_PREFIX)) {
      const transactionId = pickString(data, ["id"]);
      const outcome = await settleNgnBundleOrder(supabase, { txRef: bundleTxRef, transactionId: transactionId || null });
      if (outcome.status === "unverified") {
        await markWebhookProcessed(logId, `Bundle order unverified: ${outcome.detail ?? ""}`);
        return withCors({ error: "Could not verify payment" }, { status: 502 });
      }
      await markWebhookProcessed(logId);
      return withCors({ ok: true, handled: "bundle_order", status: outcome.status });
    }

    // Bank transfers into the old per-user virtual accounts are no longer credited (2026-11): that path
    // took the amount from this payload without asking Flutterwave. Bundles are bought through checkout.
    await markWebhookProcessed(logId);
    return withCors({ ok: true, skipped: true, eventType });
  } catch (error) {
    const message = formatSupabaseError(error);
    if (logId) await markWebhookProcessed(logId, message);
    return withCors({ error: "Failed to process webhook", detail: message }, { status: 500 });
  }
});
