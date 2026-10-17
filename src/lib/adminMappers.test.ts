import { describe, expect, it } from "vitest";
import { mapBundleOrder, mapEvent, mapKyc, mapPaymentsOverview, mapPayout, mapStats, mapTransaction, mapUser } from "./adminMappers";

describe("admin mappers", () => {
  it("maps event statuses: scheduled/draft are upcoming", () => {
    expect(mapEvent({ id: "1", status: "scheduled" }).status).toBe("upcoming");
    expect(mapEvent({ id: "1", status: "draft" }).status).toBe("upcoming");
    expect(mapEvent({ id: "1", status: "live" }).status).toBe("live");
    expect(mapEvent({ id: "1", status: "ended", event_code: "AB12CD", host_name: "Ada" })).toMatchObject({ status: "ended", code: "AB12CD", hostName: "Ada" });
  });
  it("converts stats kobo to naira and keeps counts", () => {
    expect(mapStats({ totalVolume: 12345, todayVolume: 100, totalFeeRevenue: 250, todayFeeRevenue: 0, flaggedTransactions: 2, stuckWithdrawals: 1, totalUsers: 5 }))
      .toMatchObject({ totalVolume: 123.45, todayVolume: 1, totalFeeRevenue: 2.5, flaggedTransactions: 2, stuckWithdrawals: 1, totalUsers: 5 });
  });
  it("maps KYC rows with user fields", () => {
    expect(mapKyc({ id: "k", user_id: "u", user_name: "Ada", user_email: "a@x", level: 2, status: "rejected", rejection_reason: "Face mismatch", created_at: "2026-10-01T00:00:00Z" }))
      .toMatchObject({ userName: "Ada", userEmail: "a@x", level: 2, status: "rejected", rejectionReason: "Face mismatch" });
  });
  it("maps USDC amounts with 6 decimals", () => {
    expect(mapTransaction({ id: "t", currency: "USDC", amount: 2_500_000, net_amount: 2_500_000 }).amount).toBe(2.5);
  });
  it("derives the users KYC label from kyc_level", () => {
    expect(mapUser({ id: "u", kyc_level: 0 }).kycStatus).toBe("none");
    expect(mapUser({ id: "u", kyc_level: 1 }).kycStatus).toBe("email");
    expect(mapUser({ id: "u", kyc_level: 2 }).kycStatus).toBe("verified");
    expect(mapUser({ id: "u", suspended_reason: "Chargebacks" }).suspendedReason).toBe("Chargebacks");
  });
  it("maps a stuck NGN bundle sale payout", () => {
    const p = mapPayout({
      id: "t1", user_id: "u1", user_name: "Ada", currency: "NGN", amount: -250000, fee: 5000, status: "processing",
      provider: "flutterwave", idempotency_key: "SELL-1", metadata: {
        kind: "bundle_sale", bundles: 25, needs_review: true,
        last_provider_check: { status: "non_terminal", provider_status: "PENDING", at: "2026-10-17T10:00:00Z" },
      }, created_at: "2026-10-17T09:00:00Z",
    });
    expect(p).toMatchObject({ amount: 2500, fee: 50, kind: "sale", bundles: 25, needsReview: true, reference: "SELL-1", userName: "Ada" });
    expect(p.lastCheck?.status).toBe("non_terminal");
  });
  it("maps a USDC withdrawal amount in micro-units", () => {
    expect(mapPayout({ id: "t2", currency: "USDC", amount: -2_500_000, metadata: null }).amount).toBe(2.5);
    expect(mapPayout({ id: "t2", currency: "USDC", amount: -1, metadata: null }).kind).toBe("withdrawal");
  });
  it("flags paid-but-failed NGN orders until a refund is recorded", () => {
    const base = { id: "o1", currency: "NGN", amount: 500000, bundles: 50, status: "failed", tx_ref: "bndl_1", provider_ref: "flw-9" };
    expect(mapBundleOrder(base)).toMatchObject({ amount: 5000, paidButFailed: true });
    expect(mapBundleOrder({ ...base, provider_ref: null }).paidButFailed).toBe(false);
    const refunded = mapBundleOrder({ ...base, refund_reference: "GTB-1", refund_amount_kobo: 500000, refunded_at: "2026-10-17T11:00:00Z" });
    expect(refunded.paidButFailed).toBe(false);
    expect(refunded.refund).toMatchObject({ reference: "GTB-1", amount: 5000 });
  });
  it("maps the money overview by type and queue", () => {
    const o = mapPaymentsOverview({ money: {
      by_type: [{ type: "purchase", currency: "NGN", count_today: 2, amount_today: 150000, count_7d: 9, amount_7d: 900000 }],
      queue: { payouts_needing_review: 1, orders_paid_failed: 2, orders_pending_float: 0 },
    } });
    expect(o.money.byType[0]).toMatchObject({ type: "purchase", countToday: 2, amountToday: 1500, amount7d: 9000 });
    expect(o.money.queue).toEqual({ payoutsNeedingReview: 1, ordersPaidFailed: 2, ordersPendingFloat: 0 });
  });
  it("converts USDC dashboard volume from micro-units", () => {
    expect(mapStats({ usdcVolume: 3_000_000, usdcTodayVolume: 1_000_000 })).toMatchObject({ usdcVolume: 3, usdcTodayVolume: 1 });
  });
  it("shows a USDC bundle sale in USDC, with its address and on-chain hash", () => {
    const p = mapPayout({
      id: "t3", currency: "NGN", amount: -150000, provider: "blockradar", idempotency_key: "SELL-u",
      metadata: { kind: "bundle_sale_usdc", bundles: 15, usdc_micro: 1_000_000, network_fee_micro: 50_000, address: "0xabc", tx_hash: "0xhash" },
    });
    expect(p).toMatchObject({ currency: "USDC", amount: 1, ngnAmount: 1500, address: "0xabc", txHash: "0xhash", kind: "sale" });
  });
  it("flags a payout the provider paid after it was marked failed", () => {
    const p = mapPayout({ id: "t4", currency: "NGN", amount: -1000, status: "failed", metadata: { provider_paid_after_failed: { at: "2026-10-17T12:00:00Z" } } });
    expect(p.paidAfterFailed?.toISOString()).toBe("2026-10-17T12:00:00.000Z");
    expect(mapPayout({ id: "t5", currency: "NGN", amount: -1, metadata: {} }).paidAfterFailed).toBeUndefined();
  });
  it("treats a blank payment reference as unpaid", () => {
    expect(mapBundleOrder({ id: "o2", currency: "NGN", amount: 5000, status: "failed", provider_ref: "  " }).paidButFailed).toBe(false);
  });
  it("hides treasury data the server left out for the role", () => {
    expect(mapPaymentsOverview({ treasury: null, recent_topups: null }).money.treasuryVisible).toBe(false);
    const f = mapPaymentsOverview({ treasury: [{ currency: "USDC", balance: 2_000_000, locked_balance: 500_000 }], recent_topups: [] });
    expect(f.money.treasuryVisible).toBe(true);
    expect(f.money.treasury[0]).toEqual({ currency: "USDC", balance: 2, locked: 0.5 });
  });
});
