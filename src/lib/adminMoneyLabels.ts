/**
 * How the admin names what people hold and move. An NGN wallet holds bundles (one bundle is one
 * naira of value, but Doings is a gifting app and never calls a person's bundles "naira"), so
 * bundle movements are counted in bundles. Real money leaving or entering (payouts, deposits) and
 * USDC keep their currency.
 */
const BUNDLE_TYPES = new Set(["send", "receive", "spray", "giveaway", "giveaway_refund", "purchase"]);

const naira = (n: number) => new Intl.NumberFormat("en-NG", { style: "currency", currency: "NGN", minimumFractionDigits: 0 }).format(n);
const dollars = (n: number) => new Intl.NumberFormat("en-US", { style: "currency", currency: "USD", minimumFractionDigits: 2 }).format(n);
const bundles = (n: number) => `${new Intl.NumberFormat("en-NG", { maximumFractionDigits: 2 }).format(n)} ${n === 1 ? "bundle" : "bundles"}`;

export const bagLabel = (currency: string): string => (currency === "USDC" ? "USDC" : "Bundles");

/** What a person holds in a wallet. */
export const holdingText = (amount: number, currency: string): string => (currency === "USDC" ? dollars(amount) : bundles(amount));

/**
 * What a transaction is called. A share and a spray are both stored as "send" on one side and
 * "receive" on the other; the description says which it was ("Shared with @x", "Spray at event …").
 * A giveaway row is the creator funding it ("Giveaway funding: …", bundles out) or someone claiming
 * it ("Giveaway redemption: …", bundles in); with no description the sign of the amount says which.
 * When nothing says, the row is not guessed at.
 */
export function transactionLabel(type: string, description = "", amount?: number): string {
  if (type === "giveaway") {
    if (/^giveaway funding\b/i.test(description)) return "giveaway given";
    if (/^giveaway redemption\b/i.test(description)) return "giveaway received";
    if (amount != null && amount !== 0) return amount < 0 ? "giveaway given" : "giveaway received";
    return "giveaway";
  }
  if (type !== "send" && type !== "receive") return type.replace(/_/g, " ");
  const way = type === "send" ? "sent" : "received";
  if (/^spray\b/i.test(description)) return `spray ${way}`;
  if (/^shared with\b/i.test(description)) return `share ${way}`;
  return `bundles ${way}`;
}

/** The label with one leading capital ("Giveaway refund"), for badges and lists. */
export function transactionTitle(type: string, description = "", amount?: number): string {
  const label = transactionLabel(type, description, amount);
  return label.charAt(0).toUpperCase() + label.slice(1);
}

export function transactionAmountText(amount: number, currency: string, type: string): string {
  if (currency === "USDC") return dollars(amount);
  return BUNDLE_TYPES.has(type) ? bundles(amount) : naira(amount);
}

/**
 * A payout: the real money that left (naira, or dollars for a USDC payout) and, when the row is a
 * bundle sale, the bundles the person sold for it.
 */
export function payoutText(p: { amount: number; currency: string; bundlesSold?: number; usdcPaid?: number }): string {
  const paid = p.usdcPaid != null ? dollars(p.usdcPaid) : p.currency === "USDC" ? dollars(p.amount) : naira(p.amount);
  return `${paid} paid out${p.bundlesSold != null ? ` · ${bundles(p.bundlesSold)} sold` : ""}`;
}
