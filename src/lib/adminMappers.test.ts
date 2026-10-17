import { describe, expect, it } from "vitest";
import { mapEvent, mapKyc, mapStats, mapTransaction, mapUser } from "./adminMappers";

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
});
