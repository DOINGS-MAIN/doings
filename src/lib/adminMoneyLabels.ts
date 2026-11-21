/**
 * How the admin names what people hold and move. An NGN wallet holds bundles (one bundle is one
 * naira of value, but Doings is a gifting app and never calls a person's bundles "naira"), so
 * bundle movements are counted in bundles. Real money leaving or entering (payouts, deposits) and
 * USDC keep their currency.
 */
const BUNDLE_TYPES = new Set(["send", "receive", "spray", "giveaway", "giveaway_refund", "purchase"]);
const TYPE_LABELS: Record<string, string> = { send: "share sent", receive: "share received" };

const naira = (n: number) => new Intl.NumberFormat("en-NG", { style: "currency", currency: "NGN", minimumFractionDigits: 0 }).format(n);
const dollars = (n: number) => new Intl.NumberFormat("en-US", { style: "currency", currency: "USD", minimumFractionDigits: 2 }).format(n);
const bundles = (n: number) => `${new Intl.NumberFormat("en-NG", { maximumFractionDigits: 2 }).format(n)} ${n === 1 ? "bundle" : "bundles"}`;

export const bagLabel = (currency: string): string => (currency === "USDC" ? "USDC" : "Bundles");

/** What a person holds in a wallet. */
export const holdingText = (amount: number, currency: string): string => (currency === "USDC" ? dollars(amount) : bundles(amount));

export const transactionLabel = (type: string): string => TYPE_LABELS[type] ?? type.replace(/_/g, " ");

export function transactionAmountText(amount: number, currency: string, type: string): string {
  if (currency === "USDC") return dollars(amount);
  return BUNDLE_TYPES.has(type) ? bundles(amount) : naira(amount);
}
