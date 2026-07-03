import type { WithdrawalFeeSettings } from "@/types/finance";

export type WithdrawalFeeBreakdown = {
  platformFeeNaira: number;
  transactionFeeNaira: number;
  totalFeeNaira: number;
};

export function calculateWithdrawalFees(
  amountNaira: number,
  settings: WithdrawalFeeSettings,
): WithdrawalFeeBreakdown {
  const amountKobo = Math.round(amountNaira * 100);
  const platformFeeKobo = Math.round(amountKobo * settings.platformFeePercent / 100);
  const transactionFeeKobo = Math.round(settings.transactionFeeNaira * 100);
  return {
    platformFeeNaira: platformFeeKobo / 100,
    transactionFeeNaira: transactionFeeKobo / 100,
    totalFeeNaira: (platformFeeKobo + transactionFeeKobo) / 100,
  };
}

export const DEFAULT_WITHDRAWAL_FEE_SETTINGS: WithdrawalFeeSettings = {
  platformFeePercent: 0,
  transactionFeeNaira: 50,
};
