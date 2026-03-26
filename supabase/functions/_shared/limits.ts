import { getServiceClient } from "./db.ts";

/**
 * Tier-based daily transaction limits (in smallest currency units).
 *
 * NGN limits are in kobo. USDT limits are in micro-USDT.
 * Transfers (in-app) have separate, higher limits since funds stay on-platform.
 */

const WITHDRAWAL_LIMITS: Record<string, Record<number, number>> = {
  NGN: {
    0: 0,
    1: 0,
    2: 20_000_000,    // ₦200,000
    3: 200_000_000,   // ₦2,000,000
  },
  USDT: {
    0: 0,
    1: 0,
    2: 500_000_000,   // 500 USDT
    3: 5_000_000_000, // 5,000 USDT
  },
};

const TRANSFER_LIMITS: Record<string, Record<number, number>> = {
  NGN: {
    0: 0,
    1: 5_000_000,     // ₦50,000
    2: 50_000_000,    // ₦500,000
    3: 500_000_000,   // ₦5,000,000
  },
  USDT: {
    0: 0,
    1: 100_000_000,   // 100 USDT
    2: 1_000_000_000, // 1,000 USDT
    3: 10_000_000_000,// 10,000 USDT
  },
};

export type LimitCheckResult = { allowed: boolean; reason: string };

async function getDailySpent(
  userId: string,
  currency: string,
  txTypes: string[],
): Promise<number> {
  const supabase = getServiceClient();
  const startOfDay = new Date();
  startOfDay.setUTCHours(0, 0, 0, 0);

  const { data, error } = await supabase
    .from("transactions")
    .select("amount")
    .eq("user_id", userId)
    .eq("currency", currency)
    .in("type", txTypes)
    .in("status", ["completed", "pending"])
    .gte("created_at", startOfDay.toISOString());

  if (error) throw error;

  return (data ?? []).reduce((sum, row) => sum + Math.abs(Number(row.amount)), 0);
}

export async function checkWithdrawalLimit(
  userId: string,
  kycLevel: number,
  currency: string,
  amountSmallestUnit: number,
): Promise<LimitCheckResult> {
  const tierLimits = WITHDRAWAL_LIMITS[currency];
  if (!tierLimits) return { allowed: false, reason: `Unsupported currency: ${currency}` };

  const dailyLimit = tierLimits[kycLevel] ?? 0;
  if (dailyLimit === 0) {
    return { allowed: false, reason: `Withdrawals not available at KYC level ${kycLevel}` };
  }

  const spent = await getDailySpent(userId, currency, ["withdrawal"]);
  const remaining = dailyLimit - spent;

  if (amountSmallestUnit > remaining) {
    const unit = currency === "NGN" ? 100 : 1_000_000;
    const symbol = currency === "NGN" ? "₦" : "";
    const suffix = currency === "USDT" ? " USDT" : "";
    return {
      allowed: false,
      reason: `Daily withdrawal limit exceeded. Limit: ${symbol}${(dailyLimit / unit).toLocaleString()}${suffix}, remaining today: ${symbol}${(Math.max(0, remaining) / unit).toLocaleString()}${suffix}`,
    };
  }

  return { allowed: true, reason: "" };
}

export async function checkTransferLimit(
  userId: string,
  kycLevel: number,
  currency: string,
  amountSmallestUnit: number,
): Promise<LimitCheckResult> {
  const tierLimits = TRANSFER_LIMITS[currency];
  if (!tierLimits) return { allowed: false, reason: `Unsupported currency: ${currency}` };

  const dailyLimit = tierLimits[kycLevel] ?? 0;
  if (dailyLimit === 0) {
    return { allowed: false, reason: `Transfers not available at KYC level ${kycLevel}` };
  }

  const spent = await getDailySpent(userId, currency, ["transfer"]);
  const remaining = dailyLimit - spent;

  if (amountSmallestUnit > remaining) {
    const unit = currency === "NGN" ? 100 : 1_000_000;
    const symbol = currency === "NGN" ? "₦" : "";
    const suffix = currency === "USDT" ? " USDT" : "";
    return {
      allowed: false,
      reason: `Daily transfer limit exceeded. Limit: ${symbol}${(dailyLimit / unit).toLocaleString()}${suffix}, remaining today: ${symbol}${(Math.max(0, remaining) / unit).toLocaleString()}${suffix}`,
    };
  }

  return { allowed: true, reason: "" };
}
