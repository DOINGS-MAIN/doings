import type { FinanceTransaction } from "@/types/finance";

export type FxSwapGroup = {
  kind: "fx_swap";
  quoteId: string;
  side: "buy" | "sell";
  ngn: FinanceTransaction;
  usdc: FinanceTransaction;
  /** Primary row for lists — uses the USDC leg id for deep links */
  primary: FinanceTransaction;
};

export type DisplayTransaction =
  | { kind: "single"; transaction: FinanceTransaction }
  | FxSwapGroup;

function isUserFxLeg(t: FinanceTransaction): boolean {
  const key = t.idempotencyKey ?? "";
  return key.includes("-ngn-out") || key.includes("-ngn-in") || key.includes("-usdc-in") || key.includes("-usdc-out");
}

function fxLegKind(key: string): "ngn-out" | "ngn-in" | "usdc-in" | "usdc-out" | null {
  if (key.endsWith("-ngn-out")) return "ngn-out";
  if (key.endsWith("-ngn-in")) return "ngn-in";
  if (key.endsWith("-usdc-in")) return "usdc-in";
  if (key.endsWith("-usdc-out")) return "usdc-out";
  return null;
}

/** Merge paired FX swap legs (same quote_id) into one history row. */
export function groupFxSwapTransactions(transactions: FinanceTransaction[]): DisplayTransaction[] {
  const swapLegs = new Map<string, FinanceTransaction[]>();
  const singles: FinanceTransaction[] = [];

  for (const t of transactions) {
    const quoteId = t.metadata?.quote_id as string | undefined;
    if (t.type === "swap" && quoteId && isUserFxLeg(t)) {
      const legs = swapLegs.get(quoteId) ?? [];
      legs.push(t);
      swapLegs.set(quoteId, legs);
    } else {
      singles.push(t);
    }
  }

  const grouped: DisplayTransaction[] = [];

  for (const [quoteId, legs] of swapLegs) {
    const ngn =
      legs.find((l) => fxLegKind(l.idempotencyKey ?? "") === "ngn-out") ??
      legs.find((l) => fxLegKind(l.idempotencyKey ?? "") === "ngn-in") ??
      legs.find((l) => l.currency === "NGN");
    const usdc =
      legs.find((l) => fxLegKind(l.idempotencyKey ?? "") === "usdc-in") ??
      legs.find((l) => fxLegKind(l.idempotencyKey ?? "") === "usdc-out") ??
      legs.find((l) => l.currency === "USDC");

    if (ngn && usdc) {
      const side = ((ngn.metadata?.side ?? usdc.metadata?.side) as "buy" | "sell" | undefined) ?? "buy";
      grouped.push({
        kind: "fx_swap",
        quoteId,
        side,
        ngn,
        usdc,
        primary: usdc,
      });
    } else {
      for (const leg of legs) {
        singles.push(leg);
      }
    }
  }

  const result: DisplayTransaction[] = [
    ...grouped,
    ...singles.map((transaction) => ({ kind: "single" as const, transaction })),
  ];

  result.sort((a, b) => {
    const aTime =
      a.kind === "fx_swap"
        ? Math.max(a.ngn.createdAt.getTime(), a.usdc.createdAt.getTime())
        : a.transaction.createdAt.getTime();
    const bTime =
      b.kind === "fx_swap"
        ? Math.max(b.ngn.createdAt.getTime(), b.usdc.createdAt.getTime())
        : b.transaction.createdAt.getTime();
    return bTime - aTime;
  });

  return result;
}

export function fxSwapTitle(group: FxSwapGroup): string {
  const usdcAbs = Math.abs(group.usdc.amount);
  const usdcLabel = usdcAbs.toFixed(2);
  return group.side === "buy" ? `Bought ${usdcLabel} USDC` : `Sold ${usdcLabel} USDC`;
}

export function fxSwapSubtitle(group: FxSwapGroup): string {
  const ngnAbs = Math.abs(group.ngn.amount);
  const formatted = ngnAbs.toLocaleString(undefined, { minimumFractionDigits: 2, maximumFractionDigits: 2 });
  return group.side === "buy" ? `Paid ₦${formatted}` : `Received ₦${formatted}`;
}

/** Pick the row to render for currency tab filters. */
export function fxSwapDisplayLeg(group: FxSwapGroup, filter: "all" | "NGN" | "USDC"): FinanceTransaction {
  if (filter === "NGN") return group.ngn;
  if (filter === "USDC") return group.usdc;
  return group.usdc;
}

export function filterDisplayTransactions(
  items: DisplayTransaction[],
  filter: "all" | "NGN" | "USDC"
): DisplayTransaction[] {
  if (filter === "all") return items;
  return items.filter((item) => {
    if (item.kind === "single") return item.transaction.currency === filter;
    return filter === "NGN" || filter === "USDC";
  });
}
