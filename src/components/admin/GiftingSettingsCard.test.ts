import { describe, expect, it } from "vitest";
import { giftingPayload, parseNairaLimit } from "./GiftingSettingsCard";

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
