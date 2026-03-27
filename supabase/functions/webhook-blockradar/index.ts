import { corsHeaders, withCors } from "../_shared/cors.ts";
import { hmacHex } from "../_shared/crypto.ts";
import { getServiceClient } from "../_shared/db.ts";
import { insertWebhookLog, markWebhookProcessed } from "../_shared/webhook.ts";

type BlockradarData = {
  address?: string;
  amount?: string | number;
  asset?: string;
  network?: string;
  hash?: string;
  reference?: string;
  status?: string;
};

function toMicroUsdt(amount: string | number | undefined): number {
  const parsed = Number(amount ?? 0);
  if (!Number.isFinite(parsed) || parsed <= 0) return 0;
  return Math.round(parsed * 1_000_000);
}

Deno.serve(async (req) => {
  if (req.method === "OPTIONS") return new Response("ok", { headers: corsHeaders });
  if (req.method !== "POST") return withCors({ error: "Method not allowed" }, { status: 405 });

  const secret = Deno.env.get("BLOCKRADAR_WEBHOOK_SECRET") ?? "";
  if (!secret) return withCors({ error: "BLOCKRADAR_WEBHOOK_SECRET not configured" }, { status: 500 });

  const signature = req.headers.get("x-blockradar-signature");
  if (!signature) return withCors({ error: "Missing x-blockradar-signature header" }, { status: 400 });

  const raw = await req.text();
  const expected = await hmacHex("SHA-256", secret, raw);
  const signatureValid = signature.toLowerCase() === expected.toLowerCase();

  let payload: Record<string, unknown>;
  try {
    payload = JSON.parse(raw);
  } catch {
    return withCors({ error: "Invalid JSON payload" }, { status: 400 });
  }

  const data = (payload.data as BlockradarData) ?? {};
  const eventType = (payload.event as string) ?? null;
  const idempotencyKey = (data.hash as string) ?? null;

  let logId = "";
  try {
    const logInsert = await insertWebhookLog({
      provider: "blockradar",
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
      const asset = (data.asset ?? "").toUpperCase();
      if (asset !== "USDT") {
        await markWebhookProcessed(logId);
        return withCors({ ok: true, skipped: true, reason: "unsupported asset" });
      }

      const address = data.address;
      const txHash = data.hash;
      const amountMicro = toMicroUsdt(data.amount);
      if (!address || !txHash || amountMicro <= 0) {
        await markWebhookProcessed(logId, "Missing address/hash/amount for deposit");
        return withCors({ error: "Invalid deposit payload" }, { status: 400 });
      }

      const supabase = getServiceClient();
      const { data: addrRow, error: addrErr } = await supabase
        .from("wallet_addresses")
        .select("wallet_id, wallets!inner(user_id, currency)")
        .eq("address", address)
        .eq("provider", "blockradar")
        .single();

      if (addrErr || !addrRow) {
        await markWebhookProcessed(logId, `Address not found: ${address}`);
        return withCors({ error: "Address not found" }, { status: 404 });
      }

      const walletData = (addrRow as unknown as { wallets: { user_id: string; currency: string } }).wallets;
      if (walletData.currency !== "USDT") {
        await markWebhookProcessed(logId, "Address maps to non-USDT wallet");
        return withCors({ error: "Address currency mismatch" }, { status: 400 });
      }

      const { error: creditErr } = await supabase.rpc("credit_wallet", {
        p_wallet_id: (addrRow as { wallet_id: string }).wallet_id,
        p_user_id: walletData.user_id,
        p_amount: amountMicro,
        p_fee: 0,
        p_type: "deposit",
        p_description: "Blockradar USDT deposit",
        p_provider: "blockradar",
        p_provider_ref: txHash,
        p_idempotency_key: `blockradar:${txHash}`,
        p_metadata: {
          event_type: eventType,
          network: data.network ?? null,
          address,
        },
      });
      if (creditErr) throw creditErr;
      await markWebhookProcessed(logId);
      return withCors({ ok: true });
    }

    if (isWithdrawEvent) {
      const txHash = data.hash ?? data.reference;
      if (!txHash) {
        await markWebhookProcessed(logId, "Missing withdrawal hash/reference");
        return withCors({ error: "Invalid withdrawal payload" }, { status: 400 });
      }

      const isSuccess = normalizedStatus === "success" || normalizedStatus === "completed";
      const isFailed = normalizedStatus === "failed";

      if (isSuccess || isFailed) {
        const supabase = getServiceClient();
        const { data: txn } = await supabase
          .from("transactions")
          .select("id, status")
          .eq("provider", "blockradar")
          .eq("provider_ref", txHash)
          .eq("status", "pending")
          .maybeSingle();

        if (txn?.id) {
          const rpcName = isSuccess ? "complete_withdrawal" : "fail_withdrawal";
          const { error: rpcErr } = await supabase.rpc(rpcName, { p_transaction_id: txn.id });
          if (rpcErr) throw rpcErr;
        }
      }

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
