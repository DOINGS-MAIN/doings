import { corsHeaders, withCors } from "../_shared/cors.ts";
import { sha512Hex } from "../_shared/crypto.ts";
import { getServiceClient } from "../_shared/db.ts";
import { insertWebhookLog, markWebhookProcessed, safeProviderRef } from "../_shared/webhook.ts";
import { applyWithdrawalStatus } from "../_shared/psp/withdrawalFinalize.ts";

type PaymentSource = {
  accountName?: string;
  accountNumber?: string;
  bankCode?: string;
  amountPaid?: number | string;
};

type MonnifyEventData = {
  transactionReference?: string;
  paymentReference?: string;
  amountPaid?: number | string;
  paymentStatus?: string;
  accountReference?: string;
  paidOn?: string;
  customerName?: string;
  paymentSourceInformation?: PaymentSource[];
};

Deno.serve(async (req) => {
  if (req.method === "OPTIONS") return new Response("ok", { headers: corsHeaders });
  if (req.method !== "POST") return withCors({ error: "Method not allowed" }, { status: 405 });

  const clientSecret = Deno.env.get("MONNIFY_SECRET_KEY") ?? "";
  if (!clientSecret) return withCors({ error: "MONNIFY_SECRET_KEY not configured" }, { status: 500 });

  const signature = req.headers.get("monnify-signature");
  if (!signature) return withCors({ error: "Missing monnify-signature header" }, { status: 400 });

  const raw = await req.text();
  const expected = await sha512Hex(clientSecret + raw);
  const signatureValid = signature.toLowerCase() === expected.toLowerCase();

  let payload: Record<string, unknown>;
  try {
    payload = JSON.parse(raw);
  } catch {
    return withCors({ error: "Invalid JSON payload" }, { status: 400 });
  }

  const eventType = (payload.eventType as string) ?? null;
  const eventData = (payload.eventData as MonnifyEventData) ?? {};
  const idempotencyKey = (eventData.transactionReference as string) ?? null;

  let logId = "";
  try {
    const logInsert = await insertWebhookLog({
      provider: "monnify",
      payload,
      headers: Object.fromEntries(req.headers.entries()),
      signature,
      signatureValid,
      idempotencyKey,
      eventType,
    });
    logId = logInsert.id;
    if (logInsert.duplicate && logInsert.alreadyProcessed) {
      return withCors({ ok: true, duplicate: true });
    }

    if (!signatureValid) {
      await markWebhookProcessed(logId, "Invalid signature");
      return withCors({ error: "Invalid signature" }, { status: 401 });
    }

    // Handle disbursement callbacks (withdrawal completion/failure)
    if (eventType === "SUCCESSFUL_DISBURSEMENT" || eventType === "FAILED_DISBURSEMENT") {
      const ref = safeProviderRef(String(eventData.transactionReference ?? eventData.paymentReference ?? ""));
      if (ref) {
        const supabase = getServiceClient();
        const { data: txn } = await supabase
          .from("transactions")
          .select("id, provider, provider_ref, idempotency_key, status")
          .eq("type", "withdrawal")
          .eq("provider", "monnify")
          .in("status", ["pending", "processing"])
          .or(`provider_ref.eq.${ref},idempotency_key.eq.${ref}`)
          .maybeSingle();

        if (txn?.id) {
          const normalized = eventType === "SUCCESSFUL_DISBURSEMENT" ? "terminal_success" : "terminal_failure";
          await applyWithdrawalStatus(
            supabase,
            txn,
            {
              normalized,
              providerStatus: eventType,
              providerRef: ref,
            },
            "webhook",
          );
        }
      }
      await markWebhookProcessed(logId);
      return withCors({ ok: true });
    }

    // Bank transfers into per-user reserved accounts are no longer credited (2026-11).
    await markWebhookProcessed(logId);
    return withCors({ ok: true, skipped: true });
  } catch (error) {
    if (logId) await markWebhookProcessed(logId, String(error));
    return withCors({ error: "Failed to process webhook" }, { status: 500 });
  }
});
