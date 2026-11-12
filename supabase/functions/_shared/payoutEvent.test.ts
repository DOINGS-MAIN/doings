import { assertEquals } from "jsr:@std/assert";
import { payoutEvent } from "./payoutEvent.ts";

Deno.test("payoutEvent: a Flutterwave transfer webhook gives its reference and outcome", () => {
  assertEquals(
    payoutEvent("flutterwave", { event: "transfer.completed", data: { reference: "DOINGS-WD-1", status: "SUCCESSFUL" } }),
    { ref: "DOINGS-WD-1", outcome: { normalized: "terminal_success", providerStatus: "SUCCESSFUL" } },
  );
  assertEquals(
    payoutEvent("flutterwave", { event: "transfer.completed", data: { reference: "DOINGS-WD-1", status: "FAILED" } })?.outcome.normalized,
    "terminal_failure",
  );
});

Deno.test("payoutEvent: the payer's meta_data cannot change the reference or the status", () => {
  assertEquals(
    payoutEvent("flutterwave", {
      event: "transfer.completed",
      data: { reference: "DOINGS-WD-1", status: "SUCCESSFUL" },
      meta_data: { reference: "DOINGS-WD-victim", status: "FAILED" },
    }),
    { ref: "DOINGS-WD-1", outcome: { normalized: "terminal_success", providerStatus: "SUCCESSFUL" } },
  );
});

Deno.test("payoutEvent: deposits and charges are not payout events (never credited from a stored payload)", () => {
  assertEquals(payoutEvent("flutterwave", { event: "charge.completed", data: { tx_ref: "va-ref", amount: 5000000, status: "successful" } }), null);
  assertEquals(payoutEvent("nomba", { event_type: "payment_success", data: { accountNumber: "0123456789", amount: 1000000 } }), null);
  assertEquals(payoutEvent("monnify", { eventType: "SUCCESSFUL_TRANSACTION", eventData: { amountPaid: 1000000 } }), null);
  assertEquals(payoutEvent("quidax", { event: "withdraw.successful" }), null);
});

Deno.test("payoutEvent: Monnify and Nomba payout events", () => {
  assertEquals(
    payoutEvent("monnify", { eventType: "FAILED_DISBURSEMENT", eventData: { transactionReference: "R1" } }),
    { ref: "R1", outcome: { normalized: "terminal_failure", providerStatus: "FAILED_DISBURSEMENT" } },
  );
  assertEquals(payoutEvent("nomba", { eventType: "payout_failed", data: { merchantTxRef: "R2" } })?.ref, "R2");
  assertEquals(payoutEvent("nomba", { eventType: "payout_failed", data: { merchantTxRef: "R2" } })?.outcome.normalized, "terminal_failure");
});

Deno.test("payoutEvent: a real Nomba payout webhook (event_type key, reference inside data.transaction)", () => {
  assertEquals(
    payoutEvent("nomba", { event_type: "payout_failed", data: { transaction: { merchantTxRef: "DOINGS-WD-9" } } }),
    { ref: "DOINGS-WD-9", outcome: { normalized: "terminal_failure", providerStatus: "FAILED" } },
  );
  assertEquals(payoutEvent("nomba", { event_type: "payout_success", data: { transaction: { merchantTxRef: "R3" } } })?.outcome.normalized, "terminal_success");
});
