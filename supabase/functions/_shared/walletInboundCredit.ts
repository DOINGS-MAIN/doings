import type { SupabaseClient } from "https://esm.sh/@supabase/supabase-js@2.49.8";
import { formatSupabaseError } from "./formatError.ts";
import { isSamePersonName } from "./name-match.ts";
import { logPspEvent } from "./psp/pspEvents.ts";

export type InboundDepositResult =
  | { kind: "credited" }
  | { kind: "duplicate" }
  | { kind: "rejected_aml"; reason: string }
  | { kind: "error"; message: string };

function toKobo(amountNaira: number): number {
  const parsed = Number(amountNaira);
  if (!Number.isFinite(parsed) || parsed <= 0) return 0;
  return Math.round(parsed * 100);
}

export async function creditInboundDeposit(
  supabase: SupabaseClient,
  params: {
    walletId: string;
    userId: string;
    amountNaira: number;
    paymentReference: string;
    transactionReference: string;
    providerId: string;
    payerName?: string;
    metadata?: Record<string, unknown>;
    skipNameCheckEnv?: string;
  },
): Promise<InboundDepositResult> {
  const amountKobo = toKobo(params.amountNaira);
  if (amountKobo <= 0) return { kind: "error", message: "Invalid amount" };

  const idempotencyKey = `${params.providerId}:${params.paymentReference}`;

  const { data: existing } = await supabase
    .from("transactions")
    .select("id, status")
    .eq("idempotency_key", idempotencyKey)
    .maybeSingle();

  if (existing?.status === "completed") {
    return { kind: "duplicate" };
  }

  const payerName = params.payerName?.trim() ?? "";
  const skipNameCheck = params.skipNameCheckEnv
    ? Deno.env.get(params.skipNameCheckEnv) === "true"
    : false;

  if (payerName && !skipNameCheck) {
    const { data: owner } = await supabase
      .from("users")
      .select("full_name")
      .eq("id", params.userId)
      .single();

    if (owner?.full_name && !isSamePersonName(owner.full_name, payerName)) {
      await logPspEvent(supabase, {
        transactionId: existing?.id ?? null,
        providerId: params.providerId,
        direction: "inbound",
        eventType: "aml_rejected",
        status: "rejected",
        reference: params.paymentReference,
        providerRef: params.transactionReference,
        errorMessage: `AML name mismatch: payer="${payerName}" owner="${owner.full_name}"`,
      });
      return { kind: "rejected_aml", reason: "Sender name does not match account holder" };
    }
  }

  const { data: txnId, error: creditErr } = await supabase.rpc("credit_wallet", {
    p_wallet_id: params.walletId,
    p_user_id: params.userId,
    p_amount: amountKobo,
    p_fee: 0,
    p_type: "deposit",
    p_description: `${params.providerId} bank transfer deposit`,
    p_provider: params.providerId,
    p_provider_ref: params.transactionReference,
    p_idempotency_key: idempotencyKey,
    p_metadata: {
      payment_reference: params.paymentReference,
      payer_name: payerName || null,
      ...(params.metadata ?? {}),
    },
  });

  if (creditErr) {
    const errText = formatSupabaseError(creditErr);
    if (errText.includes("duplicate") || errText.includes("unique")) {
      return { kind: "duplicate" };
    }
    return { kind: "error", message: errText };
  }

  await logPspEvent(supabase, {
    transactionId: typeof txnId === "string" ? txnId : null,
    providerId: params.providerId,
    direction: "inbound",
    eventType: "wallet_credited",
    status: "terminal_success",
    reference: params.paymentReference,
    providerRef: params.transactionReference,
    responseSummary: { amount_kobo: amountKobo },
  });

  return { kind: "credited" };
}
