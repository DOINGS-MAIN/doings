import { describe, expect, it } from "vitest";
import { giftingPayload, limitsPayload, parseNairaLimit } from "./GiftingSettingsCard";

describe("parseNairaLimit", () => {
  it("reads whole naira, with or without commas and spaces", () => {
    expect(parseNairaLimit("200000")).toBe(200000);
    expect(parseNairaLimit("200,000")).toBe(200000);
    expect(parseNairaLimit(" 5 000 000 ")).toBe(5000000);
    expect(parseNairaLimit("0")).toBe(0);
  });
  it("refuses anything that is not a whole, non-negative number", () => {
    for (const bad of ["", "-5", "12.5", "abc", "1e6", "₦500"]) expect(parseNairaLimit(bad)).toBeNull();
    expect(parseNairaLimit("99999999999999999999")).toBeNull();
  });
});

describe("giftingPayload", () => {
  const limits = { shareL1: "200,000", shareL2: "5000000", giveawayL1: "200000", giveawayL2: "5,000,000" };
  it("sends the switch and every limit in kobo", () => {
    expect(giftingPayload(false, limits)).toEqual({
      _share_requires_identity: false,
      _share_l1_kobo: 20000000,
      _share_l2_kobo: 500000000,
      _giveaway_l1_kobo: 20000000,
      _giveaway_l2_kobo: 500000000,
    });
    expect(giftingPayload(true, limits)).toMatchObject({ _share_requires_identity: true });
  });
  it("refuses a bad number or a verified limit below the email-only one", () => {
    expect(giftingPayload(false, { ...limits, shareL1: "lots" })).toEqual({ error: "Enter each limit as a whole number of naira" });
    expect(giftingPayload(false, { ...limits, shareL2: "100" })).toEqual({ error: "A verified limit cannot be lower than the email-only limit" });
    expect(giftingPayload(false, { ...limits, giveawayL2: "100" })).toEqual({ error: "A verified limit cannot be lower than the email-only limit" });
  });
});

describe("limitsPayload", () => {
  const form = {
    minPurchase: "1,000", minSell: "1000", sellDaily: "2,000,000", sprayMax: "1000000",
    sprayDailyL1: "1,000,000", sprayDailyL2: "5000000", giveawayMinTotal: "100", giveawayMinEach: "10",
  };
  it("sends minimums for buying and selling in bundles and everything else in kobo", () => {
    expect(limitsPayload(form)).toEqual({
      _bundle_min_purchase: 1000,
      _bundle_sell_min: 1000,
      _sell_daily_limit_kobo: 200000000,
      _spray_max_single_kobo: 100000000,
      _spray_daily_l1_kobo: 100000000,
      _spray_daily_l2_kobo: 500000000,
      _giveaway_min_total_kobo: 10000,
      _giveaway_min_per_person_kobo: 1000,
    });
  });
  it("refuses what the server would refuse, in plain words", () => {
    expect(limitsPayload({ ...form, sellDaily: "lots" })).toEqual({ error: "Enter each limit as a whole number" });
    expect(limitsPayload({ ...form, minPurchase: "0" })).toEqual({ error: "A minimum must be at least 1" });
    expect(limitsPayload({ ...form, giveawayMinEach: "0" })).toEqual({ error: "A minimum must be at least 1" });
    expect(limitsPayload({ ...form, sprayDailyL2: "500" })).toEqual({ error: "A verified limit cannot be lower than the email-only limit" });
    expect(limitsPayload({ ...form, giveawayMinEach: "500" })).toEqual({ error: "The smallest share per person cannot be more than the smallest giveaway" });
    expect(limitsPayload({ ...form, sprayMax: "100" })).toEqual({ error: "The largest spray must be at least 200 bundles (one note)" });
    expect(limitsPayload({ ...form, sellDaily: "0" })).toEqual({ error: "The daily sale limit must be more than 0" });
    expect(limitsPayload({ ...form, sprayDailyL1: "50" })).toEqual({ error: "A daily spray limit must be 0 (sprays off) or at least 200 bundles" });
    // 0 switches sprays off for that level
    expect(limitsPayload({ ...form, sprayDailyL1: "0" })).toMatchObject({ _spray_daily_l1_kobo: 0 });
  });
});
