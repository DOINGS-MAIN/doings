import { assertEquals } from "jsr:@std/assert";
import { finalizeRpcNames, isDefiniteBlockradarRejection, isSolanaAddress, nameMatchesKyc } from "./sell.ts";

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
