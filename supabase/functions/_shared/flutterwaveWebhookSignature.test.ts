import { assertEquals } from "jsr:@std/assert";
import { verifyFlutterwaveWebhook } from "./flutterwaveWebhookSignature.ts";

const base = { rawBody: '{"event":"charge.completed"}', verifHash: null, flutterwaveSignature: null, secretHash: "", secretKey: "" };

Deno.test("verifyFlutterwaveWebhook: with no secret configured nothing verifies (a forged request must not be stored as genuine)", async () => {
  assertEquals(await verifyFlutterwaveWebhook(base), false);
  assertEquals(await verifyFlutterwaveWebhook({ ...base, verifHash: "anything" }), false);
});

Deno.test("verifyFlutterwaveWebhook: the shared hash must match", async () => {
  assertEquals(await verifyFlutterwaveWebhook({ ...base, secretHash: "s3cret", verifHash: "s3cret" }), true);
  assertEquals(await verifyFlutterwaveWebhook({ ...base, secretHash: "s3cret", verifHash: "wrong" }), false);
  assertEquals(await verifyFlutterwaveWebhook({ ...base, secretHash: "s3cret" }), false);
});
