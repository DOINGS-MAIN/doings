import { describe, expect, it } from "vitest";
import { mapBundleOrder, mapEvent, mapGiveaway, mapGiveawayDetail, mapKyc, mapPaymentsOverview, mapPayout, mapStats, mapTransaction, mapUser, mapUser360 } from "./adminMappers";

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
  it("maps a user 360 with only the sections the server sent", () => {
    const m = mapUser360({
      user: { id: "u1", full_name: "Ada Obi", status: "suspended", suspended_reason: "Chargebacks", kyc_level: 2, created_at: "2026-10-01T00:00:00Z" },
      can: { profile: true, actions: true, kyc: true, money: false, security: true, activity: true },
      sections: {
        security: { pin_set: true, pin_failed_attempts: 2, pin_locked_until: null },
        kyc: { records: [{ id: "k1", level: 2, status: "verified", verification_method: "bvn_selfie", bvn_last_four: "1234",
          selfie_match_confidence: 96.5, liveness_score: 71, submitted_at: "2026-10-02T00:00:00Z", verified_at: "2026-10-02T00:01:00Z", superseded_at: null }],
          attempts_24h: 3, attempts_max: 5 },
        activity: { events_hosted: [{ id: "e1", title: "Party", status: "live", event_code: "AB12", created_at: "2026-10-03T00:00:00Z" }], giveaways_created: 4 },
      },
    });
    expect(m.user).toMatchObject({ name: "Ada Obi", status: "suspended", suspendedReason: "Chargebacks", kycLevel: 2 });
    expect(m.money).toBeUndefined();
    expect(m.kyc?.records[0]).toMatchObject({ method: "bvn_selfie", matchScore: 96.5, livenessScore: 71, superseded: false });
    expect(m.kyc).toMatchObject({ attempts24h: 3, attemptsMax: 5 });
    expect(m.security).toMatchObject({ pinSet: true, pinFailedAttempts: 2 });
    expect(m.activity).toMatchObject({ giveawaysCreated: 4 });
  });
  it("maps user 360 money in display units", () => {
    const m = mapUser360({
      user: { id: "u1", status: "active", kyc_level: 1, created_at: "2026-10-01T00:00:00Z" },
      can: { profile: true, actions: false, kyc: false, money: true, security: true, activity: true },
      sections: { money: {
        wallets: [{ currency: "NGN", balance: 500000, locked_balance: 100000 }, { currency: "USDC", balance: 2_000_000, locked_balance: 0 }],
        transactions: [{ id: "t1", type: "withdrawal", currency: "NGN", amount: -250000, status: "completed", idempotency_key: "SELL-1", created_at: "2026-10-04T00:00:00Z" }],
        open_payouts: [], bundle_orders: [{ id: "o1", currency: "NGN", bundles: 5, amount: 50000, status: "failed", refunded_at: "2026-10-05T00:00:00Z", created_at: "2026-10-04T00:00:00Z" }],
        bank_accounts: [{ id: "b1", bank_name: "GTB", account_name: "ADA OBI", account_number: "••••6789", is_default: true }],
      } },
    });
    expect(m.money?.wallets).toEqual([{ currency: "NGN", balance: 5000, held: 1000 }, { currency: "USDC", balance: 2, held: 0 }]);
    expect(m.money?.transactions[0]).toMatchObject({ amount: 2500, reference: "SELL-1" });
    expect(m.money?.bundleOrders[0]).toMatchObject({ amount: 500, refunded: true });
    expect(m.money?.bankAccounts[0].accountNumber).toBe("••••6789");
  });
  it("maps a giveaway in naira with redeemed count from the remainder", () => {
    const g = mapGiveaway({ id: "g1", creator_id: "u1", user_name: "Ada", title: "Party", code: "ABC123", status: "active", type: "live",
      total_amount: 50000, per_person_amount: 10000, remaining_amount: 30000, max_recipients: 5, created_at: "2026-10-17T00:00:00Z" });
    expect(g).toMatchObject({ creatorName: "Ada", total: 500, perPerson: 100, remaining: 300, maxRecipients: 5, redeemedCount: 2 });
    expect(mapGiveaway({ id: "g2", total_amount: 50000, per_person_amount: 10000, remaining_amount: 0, max_recipients: 5, status: "exhausted" }).redeemedCount).toBe(5);
    // A stop sets remaining to 0, so the remainder can't tell how many claimed: use the real count.
    const stopped = mapGiveaway({ id: "g3", status: "stopped", total_amount: 50000, per_person_amount: 10000, remaining_amount: 0,
      max_recipients: 5, giveaway_redemptions: [{ count: 2 }], events: { title: "Wedding", event_code: "WED1" } });
    expect(stopped).toMatchObject({ redeemedCount: 2, eventTitle: "Wedding", eventCode: "WED1" });
  });
  it("maps a stopped giveaway's detail with redemptions", () => {
    const d = mapGiveawayDetail({
      giveaway: { id: "g1", title: "Party", code: "ABC123", status: "stopped", type: "live", total_amount: 50000, per_person_amount: 10000,
        remaining_amount: 0, max_recipients: 5, stopped_at: "2026-10-17T10:00:00Z", stop_reason: "Misleading", refund_transaction_id: "t9" },
      creator: { id: "u1", full_name: "Ada", email: "a@x" }, event: null,
      redemptions: [{ id: "r1", user_id: "u2", user_name: "Ben", amount: 10000, redeemed_at: "2026-10-17T09:00:00Z" }],
      stopped_by_email: "mod@doings.app",
    });
    expect(d.giveaway).toMatchObject({ status: "stopped", stopReason: "Misleading" });
    expect(d.redemptions[0]).toMatchObject({ userName: "Ben", amount: 100 });
    expect(d).toMatchObject({ refundTransactionId: "t9", stoppedByEmail: "mod@doings.app", creator: { name: "Ada" } });
    expect(mapGiveawayDetail({ giveaway: { id: "g1", status: "stopped", remaining_amount: 0, per_person_amount: 10000, max_recipients: 5 },
      redemptions: [], redemption_count: 3 }).giveaway.redeemedCount).toBe(3);
  });
});
