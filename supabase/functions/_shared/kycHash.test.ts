import { assertEquals } from "jsr:@std/assert";
import { kycHmac } from "./kycHash.ts";

// Same vector the Node backfill script checks, so both sides provably agree.
Deno.test("kycHmac matches the standard HMAC-SHA256 vector", async () => {
  assertEquals(
    await kycHmac("The quick brown fox jumps over the lazy dog", "key"),
    "f7bc83f430538424b13298e6aa6fb143ef4d59a14946175997479dbc2d1a3cd8",
  );
});

Deno.test("kycHmac depends on the secret", async () => {
  const a = await kycHmac("22222222222", "s1");
  const b = await kycHmac("22222222222", "s2");
  assertEquals(a.length, 64);
  assertEquals(a === b, false);
});
