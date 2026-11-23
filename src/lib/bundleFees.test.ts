import { describe, expect, it } from "vitest";
import { feeOn, feesFromSettings, feesPayload, sellFeeTooHigh } from "./bundleFees";

describe("buy and sell fees in the admin", () => {
  it("reads the server's settings into naira and percent", () => {
    expect(feesFromSettings({ buy_fee_percent: "0.00", buy_fee_flat_kobo: 15000, sell_fee_percent: "5.00", sell_fee_flat_kobo: 5000, bundle_sell_min: 1000, bundle_min_purchase: 1000 }))
      .toEqual({ buyPercent: "0", buyFlat: "150", sellPercent: "5", sellFlat: "50", minSell: 1000, minPurchase: 1000 });
  });

  it("works a fee out the way the server does: flat part plus a percentage, rounded down", () => {
    expect(feeOn(500, 0, 150)).toBe(150);
    expect(feeOn(500, 5, 50)).toBe(75);
    expect(feeOn(333, 1.5, 0)).toBe(4.99);
  });

  it("turns what was typed into what the server takes (kobo)", () => {
    expect(feesPayload({ buyPercent: "1.5", buyFlat: "100", sellPercent: "5", sellFlat: "50" }))
      .toEqual({ _buy_fee_percent: 1.5, _buy_fee_flat_kobo: 10000, _sell_fee_percent: 5, _sell_fee_flat_kobo: 5000 });
  });

  it("refuses blanks, negatives and percentages of 50 or more, saying which", () => {
    expect(feesPayload({ buyPercent: "", buyFlat: "100", sellPercent: "5", sellFlat: "50" })).toEqual({ error: "Enter the buy fee percentage" });
    expect(feesPayload({ buyPercent: "0", buyFlat: "-1", sellPercent: "5", sellFlat: "50" })).toEqual({ error: "The buy flat fee cannot be negative" });
    expect(feesPayload({ buyPercent: "0", buyFlat: "0", sellPercent: "50", sellFlat: "50" })).toEqual({ error: "The sell fee percentage must be below 50" });
    expect(feesPayload({ buyPercent: "0", buyFlat: "0", sellPercent: "abc", sellFlat: "50" })).toEqual({ error: "Enter the sell fee percentage" });
  });

  it("warns when the fee would swallow the smallest sale", () => {
    expect(sellFeeTooHigh(1000, 0, 1000)).toBe(true);
    expect(sellFeeTooHigh(1000, 5, 50)).toBe(false);
  });
});
