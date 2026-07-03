import type { SupabaseClient } from "https://esm.sh/@supabase/supabase-js@2.49.8";

export type WithdrawalFeeSettings = {
  platformFeePercent: number;
  transactionFeeKobo: number;
};

export type WithdrawalFeeBreakdown = {
  platformFeeKobo: number;
  transactionFeeKobo: number;
  totalFeeKobo: number;
};

export async function getWithdrawalFeeSettings(
  supabase: SupabaseClient,
): Promise<WithdrawalFeeSettings> {
  const { data, error } = await supabase
    .from("platform_settings")
    .select("withdrawal_platform_fee_percent, withdrawal_transaction_fee_kobo")
    .eq("id", 1)
    .single();

  if (error || !data) {
    return { platformFeePercent: 0, transactionFeeKobo: 5000 };
  }

  return {
    platformFeePercent: Number(data.withdrawal_platform_fee_percent ?? 0),
    transactionFeeKobo: Number(data.withdrawal_transaction_fee_kobo ?? 5000),
  };
}

export function calculateWithdrawalFeeKobo(
  amountKobo: number,
  settings: WithdrawalFeeSettings,
): WithdrawalFeeBreakdown {
  const platformFeeKobo = Math.round(amountKobo * settings.platformFeePercent / 100);
  const transactionFeeKobo = settings.transactionFeeKobo;
  return {
    platformFeeKobo,
    transactionFeeKobo,
    totalFeeKobo: platformFeeKobo + transactionFeeKobo,
  };
}
