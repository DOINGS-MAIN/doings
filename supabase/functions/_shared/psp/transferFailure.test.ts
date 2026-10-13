import { assertEquals } from "jsr:@std/assert";
import { classifyTransferSubmitFailure } from "./transferFailure.ts";

Deno.test("5xx, 429, no status and unparseable bodies are unknown (the transfer may exist)", () => {
  assertEquals(classifyTransferSubmitFailure(500, "Internal error"), "unknown");
  assertEquals(classifyTransferSubmitFailure(502, ""), "unknown");
  assertEquals(classifyTransferSubmitFailure(504, ""), "unknown");
  assertEquals(classifyTransferSubmitFailure(429, "Too many requests"), "unknown");
  assertEquals(classifyTransferSubmitFailure(408, "timeout"), "unknown");
  assertEquals(classifyTransferSubmitFailure(0, ""), "unknown");
  assertEquals(classifyTransferSubmitFailure(400, ""), "unknown");
});

Deno.test("a duplicate-reference 4xx is unknown (an earlier attempt may be paying)", () => {
  assertEquals(classifyTransferSubmitFailure(400, "Transfer with this reference already exists"), "unknown");
  assertEquals(classifyTransferSubmitFailure(400, "Duplicate reference"), "unknown");
});

Deno.test("a 4xx with a provider message is a definite rejection", () => {
  assertEquals(classifyTransferSubmitFailure(400, "Insufficient balance in wallet"), "rejected_terminal");
  assertEquals(classifyTransferSubmitFailure(401, "Invalid authorization key"), "rejected_terminal");
  assertEquals(classifyTransferSubmitFailure(422, "Account number is invalid"), "rejected_terminal");
});
