import { corsHeaders, withCors } from "../_shared/cors.ts";
import { getAuthedClient, getServiceClient } from "../_shared/db.ts";
import { checkWithdrawalLimit } from "../_shared/limits.ts";
import { sendUsdt } from "../_shared/blockradar.ts";
import { checkRateLimit, RATE_LIMITS } from "../_shared/rate-limit.ts";

type WithdrawBody = {
  amount: number;
  address: string;
  network?: string;
};

Deno.serve(async (req) => {
  if (req.method === "OPTIONS") return new Response("ok", { headers: corsHeaders });
  if (req.method !== "POST") return withCors({ error: "Method not allowed" }, { status: 405 });

  const authHeader = req.headers.get("Authorization");
  if (!authHeader) return withCors({ error: "Missing authorization" }, { status: 401 });

  const authedClient = getAuthedClient(authHeader);
  const { data: authData, error: authError } = await authedClient.auth.getUser();
  if (authError || !authData.user) return withCors({ error: "Unauthorized" }, { status: 401 });

  const supabase = getServiceClient();
  const { data: user, error: userErr } = await supabase
    .from("users")
    .select("id, kyc_level")
    .eq("auth_id", authData.user.id)
    .single();

  if (userErr || !user) return withCors({ error: "User not found" }, { status: 404 });
  if (user.kyc_level < 2) return withCors({ error: "KYC level 2 (BVN) required for withdrawals" }, { status: 403 });

  const rl = await checkRateLimit(RATE_LIMITS.withdrawal(user.id));
  if (!rl.allowed) return withCors({ error: "Too many withdrawal requests. Try again shortly." }, { status: 429 });

  const body = (await req.json()) as WithdrawBody;
  if (!body.amount || !body.address) {
    return withCors({ error: "amount and address are required" }, { status: 400 });
  }

  const network = body.network ?? "tron";
  const amountMicro = Math.round(body.amount * 1_000_000);
  if (amountMicro < 1_000_000) return withCors({ error: "Minimum withdrawal is 1 USDT" }, { status: 400 });

  const { allowed, reason } = await checkWithdrawalLimit(user.id, user.kyc_level, "USDT", amountMicro);
  if (!allowed) return withCors({ error: reason }, { status: 403 });

  const withdrawalFeeMicro = 1_000_000; // 1 USDT network fee
  const reference = `DOINGS-USDT-WD-${crypto.randomUUID()}`;

  const { data: wallet } = await supabase
    .from("wallets")
    .select("id")
    .eq("user_id", user.id)
    .eq("currency", "USDT")
    .single();

  if (!wallet) return withCors({ error: "USDT wallet not found" }, { status: 500 });

  let txnId: string;
  try {
    const { data, error } = await supabase.rpc("lock_withdrawal", {
      p_wallet_id: wallet.id,
      p_user_id: user.id,
      p_amount: amountMicro,
      p_fee: withdrawalFeeMicro,
      p_type: "withdrawal",
      p_description: `USDT withdrawal to ${body.address}`,
      p_provider: "blockradar",
      p_provider_ref: reference,
      p_idempotency_key: reference,
      p_metadata: {
        address: body.address,
        network,
      },
    });

    if (error) throw error;
    txnId = data as string;
  } catch (err) {
    const msg = String(err);
    if (msg.includes("Insufficient")) {
      return withCors({ error: "Insufficient balance" }, { status: 400 });
    }
    return withCors({ error: "Failed to lock funds", detail: msg }, { status: 500 });
  }

  try {
    const result = await sendUsdt({
      toAddress: body.address,
      amount: String(body.amount),
      network,
      userId: user.id,
      reference,
    });

    await supabase
      .from("transactions")
      .update({
        provider_ref: result.hash || reference,
        metadata: {
          address: body.address,
          network,
          tx_hash: result.hash,
        },
      })
      .eq("id", txnId);

    return withCors({
      ok: true,
      transaction_id: txnId,
      reference,
      tx_hash: result.hash,
      status: "pending",
    });
  } catch (err) {
    await supabase.rpc("fail_withdrawal", { p_transaction_id: txnId });
    return withCors({ error: "USDT send failed, funds released", detail: String(err) }, { status: 502 });
  }
});
