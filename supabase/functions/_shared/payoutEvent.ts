// Reads a stored payout-status webhook (pure; tested in payoutEvent.test.ts).
import { mapFlutterwaveTransferStatus, mapNombaTransferStatus } from "./psp/pspStatus.ts";

export type PayoutOutcome = { normalized: "terminal_success" | "terminal_failure" | "non_terminal"; providerStatus: string };

function pickString(obj: Record<string, unknown>, keys: string[]): string {
  for (const k of keys) {
    const v = obj[k];
    if (v != null && String(v).trim()) return String(v).trim();
  }
  return "";
}

const normalize = (cls: string): PayoutOutcome["normalized"] =>
  cls === "terminal_success" ? "terminal_success" : cls === "terminal_failure" ? "terminal_failure" : "non_terminal";

/** The payout reference and outcome in a stored payload, or null when it is not a payout status event. */
export function payoutEvent(provider: string, payload: Record<string, unknown>): { ref: string; outcome: PayoutOutcome } | null {
  if (provider === "monnify") {
    const eventType = String(payload.eventType ?? "");
    if (eventType !== "SUCCESSFUL_DISBURSEMENT" && eventType !== "FAILED_DISBURSEMENT") return null;
    const data = (payload.eventData ?? {}) as Record<string, unknown>;
    return {
      ref: pickString(data, ["transactionReference", "paymentReference"]),
      outcome: { normalized: eventType === "SUCCESSFUL_DISBURSEMENT" ? "terminal_success" : "terminal_failure", providerStatus: eventType },
    };
  }
  if (provider === "nomba") {
    // Same reading as webhook-nomba: the event name key varies, and the reference sits in data.transaction.
    const eventType = pickString(payload, ["eventType", "event", "type", "event_type"]);
    if (!/^(transfer|payout)_(success|failed|completed|refund)$/i.test(eventType)) return null;
    const outer = (payload.data || payload.eventData || payload) as Record<string, unknown>;
    const data = { ...outer, ...((outer.transaction || {}) as Record<string, unknown>) };
    const providerStatus = pickString(data, ["status", "transferStatus"]).toUpperCase() ||
      (/fail|refund/i.test(eventType) ? "FAILED" : "SUCCESS");
    return {
      ref: pickString(data, ["merchantTxRef", "orderReference", "reference", "transactionRef"]),
      outcome: { normalized: normalize(mapNombaTransferStatus(providerStatus).cls), providerStatus },
    };
  }
  if (provider === "flutterwave") {
    const eventType = pickString(payload, ["event", "event.type", "event_type"]).toLowerCase();
    if (!eventType.includes("transfer")) return null;
    // `data` only: `meta_data` is the payer's own text.
    const data = (payload.data || {}) as Record<string, unknown>;
    const providerStatus = pickString(data, ["status"]).toUpperCase() || (eventType.includes("fail") ? "FAILED" : "SUCCESSFUL");
    return {
      ref: pickString(data, ["reference", "tx_ref", "transfer_reference"]),
      outcome: { normalized: normalize(mapFlutterwaveTransferStatus(providerStatus).cls), providerStatus },
    };
  }
  return null;
}
