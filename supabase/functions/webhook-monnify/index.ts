import { corsHeaders, withCors } from "../_shared/cors.ts";
import { sha512Hex } from "../_shared/crypto.ts";
import { getServiceClient } from "../_shared/db.ts";
import { isSamePersonName } from "../_shared/name-match.ts";
import { insertWebhookLog, markWebhookProcessed } from "../_shared/webhook.ts";

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

function toKobo(amount: number | string | undefined): number {
  const parsed = Number(amount ?? 0);
  if (!Number.isFinite(parsed) || parsed <= 0) return 0;
  return Math.round(parsed * 100);
}

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
      const ref = eventData.transactionReference ?? eventData.paymentReference;
      if (ref) {
        const supabase = getServiceClient();
        const { data: txn } = await supabase
          .from("transactions")
          .select("id, status")
          .eq("provider", "monnify")
          .eq("provider_ref", ref)
          .eq("status", "pending")
          .maybeSingle();

        if (txn?.id) {
          const rpcName = eventType === "SUCCESSFUL_DISBURSEMENT" ? "complete_withdrawal" : "fail_withdrawal";
          const { error: rpcErr } = await supabase.rpc(rpcName, { p_transaction_id: txn.id });
          if (rpcErr) throw rpcErr;
        }
      }
      await markWebhookProcessed(logId);
      return withCors({ ok: true });
    }

    if (eventType !== "SUCCESSFUL_TRANSACTION" || eventData.paymentStatus !== "PAID") {
      await markWebhookProcessed(logId);
      return withCors({ ok: true, skipped: true });
    }

    const accountReference = eventData.accountReference;
    const transactionReference = eventData.transactionReference;
    if (!accountReference || !transactionReference) {
      await markWebhookProcessed(logId, "Missing accountReference or transactionReference");
      return withCors({ error: "Invalid Monnify event payload" }, { status: 400 });
    }

    const amountKobo = toKobo(eventData.amountPaid);
    if (amountKobo <= 0) {
      await markWebhookProcessed(logId, "Invalid amountPaid");
      return withCors({ error: "Invalid amountPaid" }, { status: 400 });
    }

    const supabase = getServiceClient();
    const { data: monnifyAccount, error: monnifyErr } = await supabase
      .from("monnify_reserved_accounts")
      .select("wallet_id, user_id")
      .eq("account_reference", accountReference)
      .single();

    if (monnifyErr || !monnifyAccount) {
      await markWebhookProcessed(logId, `Account reference not found: ${accountReference}`);
      return withCors({ error: "Account reference not found" }, { status: 404 });
    }

    // AML: verify sender name matches the account holder's BVN-verified name
    const payerName =
      eventData.paymentSourceInformation?.[0]?.accountName ?? eventData.customerName ?? "";
    if (payerName) {
      const { data: owner } = await supabase
        .from("users")
        .select("full_name")
        .eq("id", monnifyAccount.user_id)
        .single();

      if (owner?.full_name && !isSamePersonName(owner.full_name, payerName)) {
        await markWebhookProcessed(logId, `AML name mismatch: payer="${payerName}" owner="${owner.full_name}"`);
        return withCors({ error: "Deposit rejected: sender name does not match account holder" }, { status: 403 });
      }
    }

    const { error: creditErr } = await supabase.rpc("credit_wallet", {
      p_wallet_id: monnifyAccount.wallet_id,
      p_user_id: monnifyAccount.user_id,
      p_amount: amountKobo,
      p_fee: 0,
      p_type: "deposit",
      p_description: "Monnify bank transfer deposit",
      p_provider: "monnify",
      p_provider_ref: transactionReference,
      p_idempotency_key: `monnify:${transactionReference}`,
      p_metadata: {
        event_type: eventType,
        payment_reference: eventData.paymentReference ?? null,
        account_reference: accountReference,
        paid_on: eventData.paidOn ?? null,
      },
    });

    if (creditErr) throw creditErr;

    await markWebhookProcessed(logId);
    return withCors({ ok: true });
  } catch (error) {
    if (logId) await markWebhookProcessed(logId, String(error));
    return withCors({ error: "Failed to process webhook" }, { status: 500 });
  }
});
