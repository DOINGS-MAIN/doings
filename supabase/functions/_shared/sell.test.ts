import { assertEquals } from "jsr:@std/assert";
import { bankNameAccepted, finalizeRpcNames, isDefiniteBlockradarRejection, isSolanaAddress, nameMatchesKyc, sellIdentityFromRow } from "./sell.ts";

Deno.test("solana addresses", () => {
  assertEquals(isSolanaAddress("7EcDhSYGxXyscszYEp35KHN8vvw3svAuLKTzXwCFLtV"), true);
  assertEquals(isSolanaAddress("  7EcDhSYGxXyscszYEp35KHN8vvw3svAuLKTzXwCFLtV "), true);
  assertEquals(isSolanaAddress("0x52908400098527886E0F7030069857D2E4169EE7"), false);
  assertEquals(isSolanaAddress("0OIl" + "1".repeat(30)), false); // 0 O I l are not base58
  assertEquals(isSolanaAddress("abc"), false);
});

Deno.test("name match uses BVN names, order/case-insensitive", () => {
  assertEquals(nameMatchesKyc("ADEBAYO JOHN O", { first: "John", last: "Adebayo" }), true);
  assertEquals(nameMatchesKyc("ADEBAYO JOHN OLUWASEUN PETER", { first: "John", last: "Adebayo" }), true);
  assertEquals(nameMatchesKyc("ADEBAYO MARY", { first: "John", last: "Adebayo" }), false);
  assertEquals(nameMatchesKyc("JOHN SMITH", { first: "John", last: "Adebayo" }), false);
  assertEquals(nameMatchesKyc("", { first: "John", last: "Adebayo" }), false);
  assertEquals(nameMatchesKyc("ADEBAYO JOHN", { first: "", last: "Adebayo" }), false);
});

Deno.test("finalize dispatch", () => {
  assertEquals(finalizeRpcNames("bundle_sale"), { complete: "complete_bundle_sale", fail: "fail_bundle_sale" });
  assertEquals(finalizeRpcNames("bundle_sale_usdc"), { complete: "complete_bundle_sale", fail: "fail_bundle_sale" });
  assertEquals(finalizeRpcNames(undefined), { complete: "complete_withdrawal", fail: "fail_withdrawal" });
});

Deno.test("only a definite Blockradar 4xx counts as rejected (never timeouts / 5xx / 429)", () => {
  assertEquals(isDefiniteBlockradarRejection(new Error("Blockradar request failed: 400 — insufficient | mode=direct")), true);
  assertEquals(isDefiniteBlockradarRejection(new Error("Blockradar request failed: 422 — bad address")), true);
  assertEquals(isDefiniteBlockradarRejection(new Error("Blockradar request failed: 429 — slow down")), false);
  assertEquals(isDefiniteBlockradarRejection(new Error("Blockradar request failed: 502 — relay")), false);
  assertEquals(isDefiniteBlockradarRejection(new Error("connection reset | mode=direct")), false);
  assertEquals(isDefiniteBlockradarRejection("weird"), false);
});

Deno.test("solana addresses decode to exactly 32 bytes (Tron / BTC base58 rejected)", () => {
  assertEquals(isSolanaAddress("EPjFWdd5AufqSSqeM2qN1xzybapC8G4wEGGkZwyTDt1v"), true);
  assertEquals(isSolanaAddress("11111111111111111111111111111111"), true);
  assertEquals(isSolanaAddress("TLa2f6VPqDgRE67v1736s7bJ8Ray5wYjU7"), false);
  assertEquals(isSolanaAddress("1A1zP1eP5QGefi2DMPTfTL5SLmv7DivfNa"), false);
});

Deno.test("a Blockradar 408 is not a definite refusal", () => {
  assertEquals(isDefiniteBlockradarRejection(new Error("Blockradar request failed: 408 — timeout")), false);
});

Deno.test("with the BVN switch on, a payout account must be in the BVN name", () => {
  const legal = { first: "John", last: "Adebayo" };
  assertEquals(bankNameAccepted("ADEBAYO JOHN O", legal, true), true);
  assertEquals(bankNameAccepted("ADEBAYO MARY", legal, true), false);
  assertEquals(bankNameAccepted("ADEBAYO JOHN", null, true), false);
  assertEquals(bankNameAccepted("", legal, true), false);
});

Deno.test("with the BVN switch off there is no name to match, so any account the bank confirms is accepted", () => {
  assertEquals(bankNameAccepted("ADEBAYO MARY", null, false), true);
  assertEquals(bankNameAccepted("SOMEONE ELSE", { first: "John", last: "Adebayo" }, false), true);
  // the bank must still confirm the account exists
  assertEquals(bankNameAccepted("", null, false), false);
  assertEquals(bankNameAccepted("   ", null, false), false);
});

Deno.test("a status that cannot be read is the strict rule: BVN and selfie, judged by level", () => {
  assertEquals(sellIdentityFromRow(null, 2), { needs_bvn: true, needs_selfie: true, has_bvn: true, has_selfie: true, ok: true });
  assertEquals(sellIdentityFromRow(undefined, 1), { needs_bvn: true, needs_selfie: true, has_bvn: false, has_selfie: false, ok: false });
  assertEquals(sellIdentityFromRow({ needs_bvn: "yes" }, 1).ok, false);
  assertEquals(
    sellIdentityFromRow({ needs_bvn: false, needs_selfie: false, has_bvn: false, has_selfie: false, ok: true }, 1),
    { needs_bvn: false, needs_selfie: false, has_bvn: false, has_selfie: false, ok: true },
  );
});
