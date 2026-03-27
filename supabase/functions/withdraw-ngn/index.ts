import { corsHeaders, withCors } from "../_shared/cors.ts";
import { getAuthedClient, getServiceClient } from "../_shared/db.ts";
import { checkWithdrawalLimit } from "../_shared/limits.ts";
import { disburseFunds } from "../_shared/monnify.ts";
import { checkRateLimit, RATE_LIMITS } from "../_shared/rate-limit.ts";

type WithdrawBody = {
  amount: number;
  bank_code: string;
  account_number: string;
  account_name: string;
  narration?: string;
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
  if (!body.amount || !body.bank_code || !body.account_number || !body.account_name) {
    return withCors({ error: "amount, bank_code, account_number, and account_name are required" }, { status: 400 });
  }

  const amountKobo = Math.round(body.amount * 100);
  if (amountKobo < 10000) return withCors({ error: "Minimum withdrawal is ₦100" }, { status: 400 });

  const { allowed, reason } = await checkWithdrawalLimit(user.id, user.kyc_level, "NGN", amountKobo);
  if (!allowed) return withCors({ error: reason }, { status: 403 });

  const withdrawalFee = 5000; // ₦50 flat fee in kobo
  const reference = `DOINGS-WD-${crypto.randomUUID()}`;

  const { data: wallet } = await supabase
    .from("wallets")
    .select("id")
    .eq("user_id", user.id)
    .eq("currency", "NGN")
    .single();

  if (!wallet) return withCors({ error: "NGN wallet not found" }, { status: 500 });

  let txnId: string;
  try {
    const { data, error } = await supabase.rpc("lock_withdrawal", {
      p_wallet_id: wallet.id,
      p_user_id: user.id,
      p_amount: amountKobo,
      p_fee: withdrawalFee,
      p_type: "withdrawal",
      p_description: `NGN withdrawal to ${body.bank_code}/${body.account_number}`,
      p_provider: "monnify",
      p_provider_ref: reference,
      p_idempotency_key: reference,
      p_metadata: {
        bank_code: body.bank_code,
        account_number: body.account_number,
        account_name: body.account_name,
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
    const result = await disburseFunds({
      amount: amountKobo / 100,
      reference,
      narration: body.narration ?? "Doings withdrawal",
      destinationBankCode: body.bank_code,
      destinationAccountNumber: body.account_number,
      destinationAccountName: body.account_name,
    });

    await supabase
      .from("transactions")
      .update({
        provider_ref: result.transactionReference,
        metadata: {
          bank_code: body.bank_code,
          account_number: body.account_number,
          account_name: body.account_name,
          monnify_status: result.status,
        },
      })
      .eq("id", txnId);

    return withCors({
      ok: true,
      transaction_id: txnId,
      reference,
      status: "pending",
    });
  } catch (err) {
    await supabase.rpc("fail_withdrawal", { p_transaction_id: txnId });
    return withCors({ error: "Disbursement failed, funds released", detail: String(err) }, { status: 502 });
  }
});
