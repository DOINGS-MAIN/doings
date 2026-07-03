import { corsHeaders, withCors } from "../_shared/cors.ts";
import { getAuthUserIdFromRequest, getServiceClient } from "../_shared/db.ts";
import { checkWithdrawalLimit } from "../_shared/limits.ts";
import { checkRateLimit, RATE_LIMITS } from "../_shared/rate-limit.ts";
import { logPspEvent } from "../_shared/psp/pspEvents.ts";
import { getPlatformPaymentSettings } from "../_shared/psp/platformSettings.ts";
import { submitTransfer } from "../_shared/psp/registry.ts";
import { applyWithdrawalStatus } from "../_shared/psp/withdrawalFinalize.ts";
import { mapByProvider } from "../_shared/psp/pspStatus.ts";
import { calculateWithdrawalFeeKobo, getWithdrawalFeeSettings } from "../_shared/withdrawalFees.ts";
import { requireTransactionPin } from "../_shared/pin.ts";

type WithdrawBody = {
  /** Amount in naira (major units). Converted to kobo server-side. */
  amount: number;
  bank_code: string;
  account_number: string;
  account_name: string;
  narration?: string;
  pin: string;
};

/** Minimum withdrawal in kobo — keep in sync with src/lib/withdrawalConstants.ts */
const NGN_WITHDRAWAL_MIN_KOBO = 100_000;

Deno.serve(async (req) => {
  if (req.method === "OPTIONS") return new Response("ok", { headers: corsHeaders });
  if (req.method !== "POST") return withCors({ error: "Method not allowed" }, { status: 405 });

  const authHeader = req.headers.get("Authorization");
  if (!authHeader) return withCors({ error: "Missing authorization" }, { status: 401 });

  const authUserId = await getAuthUserIdFromRequest(authHeader);
  if (!authUserId) return withCors({ error: "Unauthorized" }, { status: 401 });

  const supabase = getServiceClient();
  const { data: user, error: userErr } = await supabase
    .from("users")
    .select("id, kyc_level")
    .eq("auth_id", authUserId)
    .single();

  if (userErr || !user) return withCors({ error: "User not found" }, { status: 404 });
  if (user.kyc_level < 2) return withCors({ error: "KYC level 2 (BVN) required for withdrawals" }, { status: 403 });

  const body = (await req.json()) as WithdrawBody;
  const pinCheck = await requireTransactionPin(supabase, user.id, body.pin);
  if (pinCheck) return pinCheck;

  const rl = await checkRateLimit(RATE_LIMITS.withdrawal(user.id));
  if (!rl.allowed) return withCors({ error: "Too many withdrawal requests. Try again shortly." }, { status: 429 });

  if (!body.amount || !body.bank_code || !body.account_number || !body.account_name) {
    return withCors({ error: "amount, bank_code, account_number, and account_name are required" }, { status: 400 });
  }

  const amountKobo = Math.round(body.amount * 100);
  if (amountKobo < NGN_WITHDRAWAL_MIN_KOBO) {
    return withCors({ error: `Minimum withdrawal is ₦${NGN_WITHDRAWAL_MIN_KOBO / 100}` }, { status: 400 });
  }

  const { allowed, reason } = await checkWithdrawalLimit(user.id, user.kyc_level, "NGN", amountKobo);
  if (!allowed) return withCors({ error: reason }, { status: 403 });

  const feeSettings = await getWithdrawalFeeSettings(supabase);
  const feeBreakdown = calculateWithdrawalFeeKobo(amountKobo, feeSettings);
  const withdrawalFee = feeBreakdown.totalFeeKobo;
  const reference = `DOINGS-WD-${crypto.randomUUID()}`;

  const { data: wallet } = await supabase
    .from("wallets")
    .select("id")
    .eq("user_id", user.id)
    .eq("currency", "NGN")
    .single();

  if (!wallet) return withCors({ error: "NGN wallet not found" }, { status: 500 });

  let platform;
  try {
    platform = await getPlatformPaymentSettings(supabase);
  } catch {
    return withCors({ error: "Payment provider not configured" }, { status: 500 });
  }
  const providerId = platform.disbursementProviderId;

  let txnId: string;
  try {
    const { data, error } = await supabase.rpc("lock_withdrawal", {
      p_wallet_id: wallet.id,
      p_user_id: user.id,
      p_amount: amountKobo,
      p_fee: withdrawalFee,
      p_type: "withdrawal",
      p_description: `NGN withdrawal to ${body.bank_code}/${body.account_number}`,
      p_provider: providerId,
      p_provider_ref: reference,
      p_idempotency_key: reference,
      p_metadata: {
        bank_code: body.bank_code,
        account_number: body.account_number,
        account_name: body.account_name,
        fee_breakdown: {
          platform_fee_percent: feeSettings.platformFeePercent,
          platform_fee_kobo: feeBreakdown.platformFeeKobo,
          transaction_fee_kobo: feeBreakdown.transactionFeeKobo,
          total_fee_kobo: feeBreakdown.totalFeeKobo,
        },
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
    await logPspEvent(supabase, {
      transactionId: txnId,
      providerId,
      direction: "outbound",
      eventType: "api_request",
      reference,
      requestSummary: {
        amount_naira: amountKobo / 100,
        bank_code: body.bank_code,
        account_number: body.account_number,
      },
    });

    const result = await submitTransfer({
      providerId,
      env: platform.pspEnv,
      reference,
      amountNaira: amountKobo / 100,
      destinationBankCode: body.bank_code,
      destinationAccountNumber: body.account_number,
      destinationAccountName: body.account_name,
      narration: body.narration ?? "Doings withdrawal",
    });

    await logPspEvent(supabase, {
      transactionId: txnId,
      providerId,
      direction: "outbound",
      eventType: "api_response",
      status: result.kind,
      providerStatus: "providerStatus" in result ? result.providerStatus : null,
      reference,
      providerRef: "providerRef" in result ? result.providerRef : null,
      responseSummary: result as unknown as Record<string, unknown>,
      errorMessage: result.kind === "rejected_terminal" ? result.message : null,
    });

    if (result.kind === "rejected_terminal") {
      await supabase.rpc("fail_withdrawal", { p_transaction_id: txnId });
      return withCors({
        error: "Disbursement rejected",
        detail: result.message,
        provider_status: result.providerStatus,
      }, { status: 502 });
    }

    const providerRef = "providerRef" in result ? result.providerRef : reference;
    const providerStatus = "providerStatus" in result ? result.providerStatus : "";

    await supabase
      .from("transactions")
      .update({
        provider_ref: providerRef,
        metadata: {
          bank_code: body.bank_code,
          account_number: body.account_number,
          account_name: body.account_name,
          psp_status: providerStatus,
        },
      })
      .eq("id", txnId);

    const mapped = mapByProvider(providerId, providerStatus);
    const finalizeOutcome = {
      normalized: result.kind === "accepted" || mapped.cls === "terminal_success"
        ? "terminal_success" as const
        : mapped.cls === "terminal_failure"
        ? "terminal_failure" as const
        : "non_terminal" as const,
      providerStatus,
      providerRef,
    };

    const finalState = await applyWithdrawalStatus(
      supabase,
      {
        id: txnId,
        provider: providerId,
        idempotency_key: reference,
        provider_ref: providerRef,
        status: "pending",
      },
      finalizeOutcome,
      "submit",
    );

    return withCors({
      ok: true,
      transaction_id: txnId,
      reference,
      status: finalState === "completed" ? "completed" : "processing",
    });
  } catch (err) {
    await logPspEvent(supabase, {
      transactionId: txnId,
      providerId,
      direction: "outbound",
      eventType: "api_response",
      status: "error",
      reference,
      errorMessage: String(err),
    });
    await supabase.rpc("fail_withdrawal", { p_transaction_id: txnId });
    return withCors({ error: "Disbursement failed, funds released", detail: String(err) }, { status: 502 });
  }
});
