import { corsHeaders, withCors } from "../_shared/cors.ts";
import { hmacHex } from "../_shared/crypto.ts";
import { getServiceClient } from "../_shared/db.ts";
import { insertWebhookLog, markWebhookProcessed } from "../_shared/webhook.ts";

type QuidaxData = {
  reference?: string;
  txid?: string;
  status?: string;
  amount?: string | number;
  currency?: string;
  asset?: string;
  recipient?: string;
  address?: string;
};

function toMicroUsdt(amount: string | number | undefined): number {
  const parsed = Number(amount ?? 0);
  if (!Number.isFinite(parsed) || parsed <= 0) return 0;
  return Math.round(parsed * 1_000_000);
}

Deno.serve(async (req) => {
  if (req.method === "OPTIONS") return new Response("ok", { headers: corsHeaders });
  if (req.method !== "POST") return withCors({ error: "Method not allowed" }, { status: 405 });

  const secret = Deno.env.get("QUIDAX_WEBHOOK_SECRET") ?? "";
  if (!secret) return withCors({ error: "QUIDAX_WEBHOOK_SECRET not configured" }, { status: 500 });

  const signature = req.headers.get("x-quidax-signature");
  if (!signature) return withCors({ error: "Missing x-quidax-signature header" }, { status: 400 });

  const raw = await req.text();
  const expected = await hmacHex("SHA-256", secret, raw);
  const signatureValid = signature.toLowerCase() === expected.toLowerCase();

  let payload: Record<string, unknown>;
  try {
    payload = JSON.parse(raw);
  } catch {
    return withCors({ error: "Invalid JSON payload" }, { status: 400 });
  }

  const eventType = (payload.event as string) ?? (payload.type as string) ?? null;
  const data = (payload.data as QuidaxData | undefined) ?? {};
  const idempotencyKey =
    (payload.reference as string) ??
    (data.reference as string) ??
    null;

  let logId = "";
  try {
    const logInsert = await insertWebhookLog({
      provider: "quidax",
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

    const normalizedEvent = (eventType ?? "").toLowerCase();
    const normalizedStatus = (data.status ?? "").toLowerCase();
    const isDepositEvent = normalizedEvent.includes("deposit");
    const isWithdrawEvent = normalizedEvent.includes("withdraw");

    if (isDepositEvent) {
      const asset = String(data.currency ?? data.asset ?? "").toUpperCase();
      if (asset !== "USDT") {
        await markWebhookProcessed(logId);
        return withCors({ ok: true, skipped: true, reason: "unsupported asset" });
      }

      // For Quidax callbacks we expect your service to set provider_ref/reference at initiation.
      const ref = data.reference ?? data.txid ?? idempotencyKey;
      const amountMicro = toMicroUsdt(data.amount);
      if (!ref || amountMicro <= 0) {
        await markWebhookProcessed(logId, "Missing deposit reference or amount");
        return withCors({ error: "Invalid deposit payload" }, { status: 400 });
      }

      const supabase = getServiceClient();
      const { data: tx, error: txErr } = await supabase
        .from("transactions")
        .select("id, wallet_id, user_id, status")
        .eq("provider", "quidax")
        .eq("provider_ref", ref)
        .single();

      if (txErr || !tx) {
        await markWebhookProcessed(logId, `Deposit transaction not found: ${ref}`);
        return withCors({ error: "Transaction not found" }, { status: 404 });
      }

      if (tx.status === "completed") {
        await markWebhookProcessed(logId);
        return withCors({ ok: true, duplicate: true });
      }

      const { error: creditErr } = await supabase.rpc("credit_wallet", {
        p_wallet_id: tx.wallet_id,
        p_user_id: tx.user_id,
        p_amount: amountMicro,
        p_fee: 0,
        p_type: "deposit",
        p_description: "Quidax USDT deposit",
        p_provider: "quidax",
        p_provider_ref: ref,
        p_idempotency_key: `quidax:deposit:${ref}`,
        p_metadata: {
          event_type: eventType,
          txid: data.txid ?? null,
          address: data.address ?? null,
        },
      });
      if (creditErr) throw creditErr;
      await markWebhookProcessed(logId);
      return withCors({ ok: true });
    }

    if (isWithdrawEvent) {
      const ref = data.reference ?? data.txid ?? idempotencyKey;
      if (!ref) {
        await markWebhookProcessed(logId, "Missing withdrawal reference");
        return withCors({ error: "Invalid withdrawal payload" }, { status: 400 });
      }

      const finalStatus =
        normalizedStatus === "success" || normalizedStatus === "completed"
          ? "completed"
          : normalizedStatus === "failed" || normalizedStatus === "rejected"
          ? "failed"
          : "processing";

      const supabase = getServiceClient();
      const updatePatch: Record<string, unknown> = {
        status: finalStatus,
        updated_at: new Date().toISOString(),
      };
      if (finalStatus === "completed") updatePatch.completed_at = new Date().toISOString();

      const { error: updateErr } = await supabase
        .from("transactions")
        .update(updatePatch)
        .eq("provider", "quidax")
        .eq("provider_ref", ref);

      if (updateErr) throw updateErr;
      await markWebhookProcessed(logId);
      return withCors({ ok: true });
    }

    await markWebhookProcessed(logId);
    return withCors({ ok: true, skipped: true });
  } catch (error) {
    if (logId) await markWebhookProcessed(logId, String(error));
    return withCors({ error: "Failed to process webhook" }, { status: 500 });
  }
});
