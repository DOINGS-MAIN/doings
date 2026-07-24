import { corsHeaders, withCors } from "../_shared/cors.ts";
import { hmacHex } from "../_shared/crypto.ts";
import { getServiceClient } from "../_shared/db.ts";
import { insertWebhookLog, markWebhookProcessed } from "../_shared/webhook.ts";

type BlockradarData = {
  address?: unknown;
  amount?: string | number;
  asset?: unknown;
  network?: unknown;
  hash?: string;
  reference?: string;
  status?: string;
  metadata?: { reference?: string; userId?: string; network?: string };
};

function toMicroUsdc(amount: string | number | undefined): number {
  const parsed = Number(amount ?? 0);
  if (!Number.isFinite(parsed) || parsed <= 0) return 0;
  return Math.round(parsed * 1_000_000);
}

/** Solana payloads send nested objects; Tron often sent plain strings. */
function normalizeAssetSymbol(asset: unknown): string {
  if (typeof asset === "string") return asset.toUpperCase();
  if (asset && typeof asset === "object") {
    const o = asset as Record<string, unknown>;
    const sym = o.symbol ?? o.ticker ?? o.name;
    if (typeof sym === "string") return sym.toUpperCase();
  }
  return "";
}

function normalizeAddress(address: unknown): string {
  if (typeof address === "string") return address;
  if (address && typeof address === "object") {
    const o = address as Record<string, unknown>;
    const addr = o.address ?? o.value;
    if (typeof addr === "string") return addr;
  }
  return "";
}

function normalizeNetwork(network: unknown): string | null {
  if (typeof network === "string") return network;
  if (network && typeof network === "object") {
    const o = network as Record<string, unknown>;
    const n = o.slug ?? o.name ?? o.symbol;
    if (typeof n === "string") return n;
  }
  return null;
}

Deno.serve(async (req) => {
  if (req.method === "OPTIONS") return new Response("ok", { headers: corsHeaders });
  if (req.method !== "POST") return withCors({ error: "Method not allowed" }, { status: 405 });

  // Blockradar docs: HMAC-SHA512 of raw body with API key (or dedicated webhook secret).
  const secret =
    (Deno.env.get("BLOCKRADAR_WEBHOOK_SECRET") ?? "").trim() ||
    (Deno.env.get("BLOCKRADAR_API_KEY") ?? "").trim();
  if (!secret) {
    return withCors({ error: "BLOCKRADAR_WEBHOOK_SECRET / BLOCKRADAR_API_KEY not configured" }, { status: 500 });
  }

  const signature = req.headers.get("x-blockradar-signature");
  if (!signature) return withCors({ error: "Missing x-blockradar-signature header" }, { status: 400 });

  const raw = await req.text();
  const expectedSha512 = await hmacHex("SHA-512", secret, raw);
  // Legacy fallback if an older secret was verified with SHA-256
  const expectedSha256 = await hmacHex("SHA-256", secret, raw);
  const sig = signature.toLowerCase();
  const signatureValid =
    sig === expectedSha512.toLowerCase() || sig === expectedSha256.toLowerCase();

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
      const asset = normalizeAssetSymbol(data.asset);
      if (asset !== "USDC") {
        await markWebhookProcessed(logId);
        return withCors({ ok: true, skipped: true, reason: "unsupported asset", asset });
      }

      const address = normalizeAddress(data.address);
      const txHash = data.hash;
      const amountMicro = toMicroUsdc(data.amount);
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
      if (walletData.currency !== "USDC") {
        await markWebhookProcessed(logId, "Address maps to non-USDC wallet");
        return withCors({ error: "Address currency mismatch" }, { status: 400 });
      }

      const { error: creditErr } = await supabase.rpc("credit_wallet", {
        p_wallet_id: (addrRow as { wallet_id: string }).wallet_id,
        p_user_id: walletData.user_id,
        p_amount: amountMicro,
        p_fee: 0,
        p_type: "deposit",
        p_description: "Blockradar USDC deposit",
        p_provider: "blockradar",
        p_provider_ref: txHash,
        p_idempotency_key: `blockradar:${txHash}`,
        p_metadata: {
          event_type: eventType,
          network: normalizeNetwork(data.network),
          address,
        },
      });
      if (creditErr) throw creditErr;
      await markWebhookProcessed(logId);
      return withCors({ ok: true });
    }

    if (isWithdrawEvent) {
      // Prefer our DOINGS reference — provider_ref is set to that at lock time.
      // Looking up by chain hash first fails when the withdraw API returns before a hash exists.
      const ourRef = data.reference || data.metadata?.reference || null;
      const chainHash = data.hash || null;
      const lookupKeys = [ourRef, chainHash].filter((v): v is string => Boolean(v));
      if (lookupKeys.length === 0) {
        await markWebhookProcessed(logId, "Missing withdrawal hash/reference");
        return withCors({ error: "Invalid withdrawal payload" }, { status: 400 });
      }

      const isSuccess =
        normalizedEvent.includes("success") ||
        normalizedStatus === "success" ||
        normalizedStatus === "completed";
      const isFailed =
        normalizedEvent.includes("fail") ||
        normalizedStatus === "failed";

      if (isSuccess || isFailed) {
        const supabase = getServiceClient();
        let txn: { id: string; status: string } | null = null;

        for (const key of lookupKeys) {
          const { data: byRef } = await supabase
            .from("transactions")
            .select("id, status")
            .eq("provider", "blockradar")
            .eq("provider_ref", key)
            .in("status", ["pending", "processing"])
            .maybeSingle();
          if (byRef?.id) {
            txn = byRef;
            break;
          }
        }

        if (!txn && ourRef) {
          const { data: byMeta } = await supabase
            .from("transactions")
            .select("id, status")
            .eq("provider", "blockradar")
            .eq("type", "withdrawal")
            .in("status", ["pending", "processing"])
            .contains("metadata", { reference: ourRef })
            .maybeSingle();
          if (byMeta?.id) txn = byMeta;
        }

        if (txn?.id) {
          const rpcName = isSuccess ? "complete_withdrawal" : "fail_withdrawal";
          const { error: rpcErr } = await supabase.rpc(rpcName, { p_transaction_id: txn.id });
          if (rpcErr) throw rpcErr;

          if (chainHash || ourRef) {
            const { data: existing } = await supabase
              .from("transactions")
              .select("metadata")
              .eq("id", txn.id)
              .maybeSingle();
            const prev =
              existing?.metadata && typeof existing.metadata === "object"
                ? (existing.metadata as Record<string, unknown>)
                : {};
            await supabase
              .from("transactions")
              .update({
                provider_ref: chainHash || ourRef || txn.id,
                metadata: {
                  ...prev,
                  ...(ourRef ? { reference: ourRef } : {}),
                  ...(chainHash ? { tx_hash: chainHash } : {}),
                },
              })
              .eq("id", txn.id);
          }
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
