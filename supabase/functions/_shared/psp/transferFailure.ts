/**
 * A transfer submit that did not return 2xx. Only a 4xx carrying the provider's own message is a
 * definite refusal (safe to release the funds). 5xx, 408, 429, no response, an empty body or a
 * duplicate-reference error mean the transfer may exist: the outcome is unknown and must be
 * settled by webhook / reconcile, never refunded on the spot.
 */
export function classifyTransferSubmitFailure(status: number, message: string): "unknown" | "rejected_terminal" {
  const msg = message.trim();
  if (!status || status >= 500 || status === 408 || status === 429) return "unknown";
  if (!msg) return "unknown";
  if (/duplicate|already exist/i.test(msg)) return "unknown";
  return status >= 400 ? "rejected_terminal" : "unknown";
}
