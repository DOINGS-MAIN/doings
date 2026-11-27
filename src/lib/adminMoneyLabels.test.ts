import { describe, expect, it } from "vitest";
import { bagLabel, holdingText, payoutText, transactionLabel, transactionAmountText, transactionTitle } from "./adminMoneyLabels";

describe("admin wording: bundles, not naira", () => {
  it("a person's NGN holding is shown as bundles", () => {
    expect(bagLabel("NGN")).toBe("Bundles");
    expect(holdingText(1800, "NGN")).toBe("1,800 bundles");
    expect(holdingText(1, "NGN")).toBe("1 bundle");
    expect(holdingText(0, "NGN")).toBe("0 bundles");
  });

  it("USDC stays in dollars", () => {
    expect(bagLabel("USDC")).toBe("USDC");
    expect(holdingText(30.05, "USDC")).toBe("$30.05");
  });

  it("a share is called a share, and a spray a spray: both arrive as 'send' and 'receive'", () => {
    expect(transactionLabel("send", "Shared with @chukkydi (sent)")).toBe("share sent");
    expect(transactionLabel("receive", "Shared with @chukkydi (received)")).toBe("share received");
    expect(transactionLabel("receive", "Spray at event 11111111-1111 (received)")).toBe("spray received");
    expect(transactionLabel("send", "Spray at event 11111111-1111 (sent)")).toBe("spray sent");
    // an older row, or one with no description, is not guessed at
    expect(transactionLabel("receive")).toBe("bundles received");
    expect(transactionLabel("send", "")).toBe("bundles sent");
    expect(transactionLabel("giveaway_refund")).toBe("giveaway refund");
    expect(transactionLabel("purchase")).toBe("purchase");
  });

  it("bundle movements are counted in bundles; payouts and deposits keep naira", () => {
    expect(transactionAmountText(200, "NGN", "send")).toBe("200 bundles");
    expect(transactionAmountText(2000, "NGN", "purchase")).toBe("2,000 bundles");
    expect(transactionAmountText(500, "NGN", "spray")).toBe("500 bundles");
    expect(transactionAmountText(1500, "NGN", "withdrawal")).toBe("₦1,500");
    expect(transactionAmountText(5, "USDC", "send")).toBe("$5.00");
  });

  it("a giveaway row says which way it went: created is given, a claim is received", () => {
    expect(transactionLabel("giveaway", "Giveaway funding: Birthday")).toBe("giveaway given");
    expect(transactionLabel("giveaway", "Giveaway redemption: 11111111-1111")).toBe("giveaway received");
    // no description to go on: the sign of the amount says it
    expect(transactionLabel("giveaway", "", -400)).toBe("giveaway given");
    expect(transactionLabel("giveaway", "", 400)).toBe("giveaway received");
    expect(transactionLabel("giveaway")).toBe("giveaway");
  });

  it("titles start with one capital and have no underscores", () => {
    expect(transactionTitle("giveaway_refund")).toBe("Giveaway refund");
    expect(transactionTitle("receive", "Spray at event 1 (received)")).toBe("Spray received");
    expect(transactionTitle("giveaway", "Giveaway redemption: 1")).toBe("Giveaway received");
    expect(transactionTitle("withdrawal")).toBe("Withdrawal");
  });

  it("a payout says the money paid out and, when known, the bundles sold", () => {
    expect(payoutText({ amount: 1900, currency: "NGN", bundlesSold: 2000 })).toBe("₦1,900 paid out · 2,000 bundles sold");
    expect(payoutText({ amount: 1900, currency: "NGN" })).toBe("₦1,900 paid out");
    expect(payoutText({ amount: 2000, currency: "NGN", bundlesSold: 2000, usdcPaid: 1.25 })).toBe("$1.25 paid out · 2,000 bundles sold");
    expect(payoutText({ amount: 5, currency: "USDC" })).toBe("$5.00 paid out");
  });
});
