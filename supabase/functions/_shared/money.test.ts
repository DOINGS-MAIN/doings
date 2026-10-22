import { assertEquals } from "jsr:@std/assert";
import { bundlesToKobo, koboToMajor, microToMajor, parseMajorAmount, parseWholeAmount } from "./money.ts";

Deno.test("parseMajorAmount NGN: 1,000 and 10,000 stay 10x apart", () => {
  assertEquals(parseMajorAmount(1000), 100_000);
  assertEquals(parseMajorAmount(10_000), 1_000_000);
  assertEquals(parseMajorAmount(100_000_000), 10_000_000_000);
});

Deno.test("parseMajorAmount NGN: kobo precision, no float drift", () => {
  assertEquals(parseMajorAmount(64.6), 6460);
  assertEquals(parseMajorAmount(0.29), 29);
  assertEquals(parseMajorAmount(1000.5), 100_050);
  assertEquals(parseMajorAmount(0.01), 1);
});

Deno.test("parseMajorAmount NGN: more than 2 decimals is refused", () => {
  assertEquals(parseMajorAmount(0.005), null);
  assertEquals(parseMajorAmount(1000.123), null);
});

Deno.test("parseMajorAmount USDC: micro precision", () => {
  assertEquals(parseMajorAmount(5, "USDC"), 5_000_000);
  assertEquals(parseMajorAmount(0.01, "USDC"), 10_000);
  assertEquals(parseMajorAmount(1.234567, "USDC"), 1_234_567);
  assertEquals(parseMajorAmount(1.2345678, "USDC"), null);
});

Deno.test("parseMajorAmount: plain digit strings are accepted, formatted ones are not", () => {
  assertEquals(parseMajorAmount("1000"), 100_000);
  assertEquals(parseMajorAmount("1000.50"), 100_050);
  assertEquals(parseMajorAmount(" 10 "), 1000);
  assertEquals(parseMajorAmount("10,000"), null);
  assertEquals(parseMajorAmount("1.000,50"), null);
  assertEquals(parseMajorAmount("₦1000"), null);
  assertEquals(parseMajorAmount("1e3"), null);
});

Deno.test("parseMajorAmount: NaN, Infinity, zero, negatives and junk are null", () => {
  for (const bad of [NaN, Infinity, -Infinity, 0, -1, -0.01, "", " ", null, undefined, {}, [], true, "abc"]) {
    assertEquals(parseMajorAmount(bad), null, `rejects ${String(bad)}`);
    assertEquals(parseMajorAmount(bad, "USDC"), null, `rejects ${String(bad)} (USDC)`);
  }
});

Deno.test("parseMajorAmount: too large to be exact is null", () => {
  assertEquals(parseMajorAmount(1e21), null);
  assertEquals(parseMajorAmount(Number.MAX_SAFE_INTEGER), null);
});

Deno.test("parseWholeAmount", () => {
  assertEquals(parseWholeAmount(1000), 1000);
  assertEquals(parseWholeAmount("10000"), 10_000);
  assertEquals(parseWholeAmount(1000.5), null);
  assertEquals(parseWholeAmount("10,000"), null);
  assertEquals(parseWholeAmount(0), null);
  assertEquals(parseWholeAmount(NaN), null);
  assertEquals(parseWholeAmount(101, 100), null);
  assertEquals(parseWholeAmount(100, 100), 100);
});

Deno.test("conversions back to major units", () => {
  assertEquals(koboToMajor(1_000_000), 10_000);
  assertEquals(koboToMajor(100_000), 1_000);
  assertEquals(microToMajor(5_000_000), 5);
  assertEquals(bundlesToKobo(1_000), 100_000);
});
