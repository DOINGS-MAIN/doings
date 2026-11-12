import { assertEquals } from "jsr:@std/assert";
import { safeProviderRef, webhookLogRow } from "./webhookLog.ts";

const base = {
  provider: "flutterwave",
  payload: { event: "charge.completed", data: { tx_ref: "bndl_1", amount: 5000 } },
  headers: { "verif-hash": "the-shared-secret", authorization: "Bearer x", "content-type": "application/json", "user-agent": "FLW", "x-forwarded-for": "1.2.3.4", cookie: "a=b" },
  signature: "the-shared-secret",
  idempotencyKey: "flw-1",
  eventType: "charge.completed",
};

Deno.test("webhookLogRow: a verified request keeps its payload but never the secret it was signed with", () => {
  assertEquals(webhookLogRow({ ...base, signatureValid: true }), {
    provider: "flutterwave",
    payload: base.payload,
    headers: { "content-type": "application/json", "user-agent": "FLW", "x-forwarded-for": "1.2.3.4" },
    signature: null,
    signature_valid: true,
    idempotency_key: "flw-1",
    event_type: "charge.completed",
  });
});

Deno.test("webhookLogRow: an unverified request leaves nothing that could be replayed or collide with a real event", () => {
  assertEquals(webhookLogRow({ ...base, signatureValid: false }), {
    provider: "flutterwave",
    payload: { unverified: true },
    headers: { "content-type": "application/json", "user-agent": "FLW", "x-forwarded-for": "1.2.3.4" },
    signature: null,
    signature_valid: false,
    idempotency_key: null,
    event_type: "charge.completed",
  });
});

Deno.test("webhookLogRow: an unverified event name is cut short (it is attacker text)", () => {
  assertEquals((webhookLogRow({ ...base, signatureValid: false, eventType: "x".repeat(500) }).event_type as string).length, 80);
});

Deno.test("safeProviderRef: only plain reference characters reach a query filter", () => {
  assertEquals(safeProviderRef("DOINGS-WD-0e2b1a84-6a3c-4c39-9a1e-1d2f3c4b5a69"), "DOINGS-WD-0e2b1a84-6a3c-4c39-9a1e-1d2f3c4b5a69");
  assertEquals(safeProviderRef("bndl_abc.123:4"), "bndl_abc.123:4");
  assertEquals(safeProviderRef("x,status.eq.completed"), "");
  assertEquals(safeProviderRef("a)b"), "");
  assertEquals(safeProviderRef(""), "");
  assertEquals(safeProviderRef("a".repeat(200)), "");
});
