import { keepPreviousData, useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { admin as adminApi } from "@/lib/supabase";
import { useAdminAuth } from "@/hooks/useAdminAuth";
import { can } from "@/types/admin";
import { mapBundleOrder, mapEvent, mapKyc, mapPaymentsOverview, mapPayout, mapQueue, mapStats, mapTransaction, mapUser } from "@/lib/adminMappers";

const STALE = 30_000;
export type EventTab = "live" | "upcoming" | "ended" | "flagged";
export type TransactionListParams = { status?: string; type?: string; provider?: string; currency?: string; flagged?: string; search?: string };

export const adminKeys = {
  all: ["admin"] as const,
  stats: () => ["admin", "stats"] as const,
  users: (p: object = {}) => ["admin", "users", p] as const,
  events: (p: object = {}) => ["admin", "events", p] as const,
  kyc: (p: object = {}) => ["admin", "kyc", p] as const,
  transactions: (p: object = {}) => ["admin", "transactions", p] as const,
  payouts: (p: object = {}) => ["admin", "payouts", p] as const,
  bundleOrders: (p: object = {}) => ["admin", "bundleOrders", p] as const,
  payments: () => ["admin", "payments"] as const,
  queue: () => ["admin", "queue"] as const,
};

const useRole = () => useAdminAuth().session?.role;
const opt = (v?: string) => (v && v !== "all" ? v : undefined);

export function useAdminStats() {
  const role = useRole();
  return useQuery({
    queryKey: adminKeys.stats(),
    queryFn: async () => mapStats((await adminApi.stats()) as Record<string, number>),
    enabled: can(role, "dashboard"),
    staleTime: STALE,
  });
}

export function useAdminUsers(p: { page: number; status?: string; search?: string }) {
  const role = useRole();
  return useQuery({
    queryKey: adminKeys.users(p),
    queryFn: async () => {
      const res = (await adminApi.users.list({ page: p.page, limit: 50, status: opt(p.status), search: p.search?.trim() || undefined })) as { users?: Record<string, unknown>[]; total?: number };
      return { rows: (res.users ?? []).map(mapUser), total: res.total ?? 0 };
    },
    enabled: can(role, "users.view"),
    staleTime: STALE,
    placeholderData: keepPreviousData,
  });
}

const TAB_FILTER: Record<EventTab, { status?: string; flagged?: string }> = {
  live: { status: "live" },
  upcoming: { status: "scheduled,draft" },
  ended: { status: "ended" },
  flagged: { flagged: "true" },
};

export function useAdminEvents(p: { tab: EventTab; page: number; limit?: number }) {
  const role = useRole();
  return useQuery({
    queryKey: adminKeys.events(p),
    queryFn: async () => {
      const res = (await adminApi.events.list({ page: p.page, limit: p.limit ?? 50, ...TAB_FILTER[p.tab] })) as { events?: Record<string, unknown>[]; total?: number };
      return { rows: (res.events ?? []).map(mapEvent), total: res.total ?? 0 };
    },
    enabled: can(role, "events.view"),
    staleTime: STALE,
    placeholderData: keepPreviousData,
  });
}

export function useAdminKyc(p: { status: "all" | "verified" | "rejected"; page: number; limit?: number }) {
  const role = useRole();
  return useQuery({
    queryKey: adminKeys.kyc(p),
    queryFn: async () => {
      const res = (await adminApi.kyc.list({ page: p.page, limit: p.limit ?? 50, status: p.status })) as { submissions?: Record<string, unknown>[]; total?: number };
      return { rows: (res.submissions ?? []).map(mapKyc), total: res.total ?? 0 };
    },
    enabled: can(role, "kyc"),
    staleTime: STALE,
    placeholderData: keepPreviousData,
  });
}

export function useAdminTransactions(p: TransactionListParams & { page: number; limit?: number }) {
  const role = useRole();
  return useQuery({
    queryKey: adminKeys.transactions(p),
    queryFn: async () => {
      const res = (await adminApi.transactions.list({
        page: p.page, limit: p.limit ?? 50,
        status: opt(p.status), type: opt(p.type), provider: opt(p.provider), currency: opt(p.currency), flagged: opt(p.flagged),
        search: p.search?.trim() || undefined,
      })) as { transactions?: Record<string, unknown>[]; total?: number; page?: number };
      return { rows: (res.transactions ?? []).map(mapTransaction), total: res.total ?? 0, page: res.page ?? p.page };
    },
    enabled: can(role, "transactions.view"),
    staleTime: STALE,
    placeholderData: keepPreviousData,
  });
}

export function useAdminPayouts(p: { page: number; status?: string; currency?: string; kind?: string; needsReview?: boolean; search?: string }) {
  const role = useRole();
  return useQuery({
    queryKey: adminKeys.payouts(p),
    queryFn: async () => {
      const res = (await adminApi.payouts.list({
        page: p.page, limit: 50, status: opt(p.status), currency: opt(p.currency), kind: opt(p.kind),
        needs_review: p.needsReview ? "true" : undefined, search: p.search?.trim() || undefined,
      })) as { payouts?: Record<string, unknown>[]; total?: number };
      return { rows: (res.payouts ?? []).map(mapPayout), total: res.total ?? 0 };
    },
    enabled: can(role, "transactions.view"),
    staleTime: STALE,
    placeholderData: keepPreviousData,
  });
}

export function useAdminPayout(id: string | null) {
  const role = useRole();
  return useQuery({
    queryKey: adminKeys.payouts({ id }),
    queryFn: async () => {
      const res = (await adminApi.payouts.get(id!)) as Record<string, unknown>;
      return {
        payout: mapPayout((res.payout as Record<string, unknown>) ?? {}),
        user: (res.user as Record<string, unknown>) ?? null,
        pspEvents: (res.psp_events as Record<string, unknown>[]) ?? [],
        webhooks: (res.webhooks as Record<string, unknown>[]) ?? [],
      };
    },
    enabled: can(role, "transactions.view") && !!id,
    staleTime: STALE,
  });
}

export function useAdminBundleOrders(p: { page: number; status?: string; currency?: string; needsRefund?: boolean; search?: string }) {
  const role = useRole();
  return useQuery({
    queryKey: adminKeys.bundleOrders(p),
    queryFn: async () => {
      const res = (await adminApi.bundleOrders.list({
        page: p.page, limit: 50, status: opt(p.status), currency: opt(p.currency),
        needs_refund: p.needsRefund ? "true" : undefined, search: p.search?.trim() || undefined,
      })) as { orders?: Record<string, unknown>[]; total?: number };
      return { rows: (res.orders ?? []).map(mapBundleOrder), total: res.total ?? 0 };
    },
    enabled: can(role, "transactions.view"),
    staleTime: STALE,
    placeholderData: keepPreviousData,
  });
}

export function useAdminBundleOrder(id: string | null) {
  const role = useRole();
  return useQuery({
    queryKey: adminKeys.bundleOrders({ id }),
    queryFn: async () => {
      const res = (await adminApi.bundleOrders.get(id!)) as Record<string, unknown>;
      return {
        order: mapBundleOrder((res.order as Record<string, unknown>) ?? {}),
        user: (res.user as Record<string, unknown>) ?? null,
        creditTransaction: (res.credit_transaction as Record<string, unknown>) ?? null,
      };
    },
    enabled: can(role, "transactions.view") && !!id,
    staleTime: STALE,
  });
}

export function useAdminPaymentsOverview() {
  const role = useRole();
  return useQuery({
    queryKey: adminKeys.payments(),
    queryFn: async () => mapPaymentsOverview((await adminApi.payments.overview()) as Record<string, unknown>),
    enabled: can(role, "payments"),
    staleTime: STALE,
  });
}

export function useAdminQueue() {
  const role = useRole();
  return useQuery({
    queryKey: adminKeys.queue(),
    queryFn: async () => mapQueue((await adminApi.queue()) as Record<string, unknown>),
    enabled: can(role, "queue"),
    staleTime: STALE,
  });
}

export function useAdminMutations() {
  const qc = useQueryClient();
  const refresh = (...keys: (keyof typeof adminKeys)[]) =>
    Promise.all(keys.map((k) => qc.invalidateQueries({ queryKey: ["admin", k] })));
  const m = useMutation({ mutationFn: (fn: () => Promise<unknown>) => fn() });
  // Runs the call, refreshes the affected lists, and returns the server's answer.
  const run = async (fn: () => Promise<unknown>, ...keys: (keyof typeof adminKeys)[]): Promise<unknown> => {
    const out = await m.mutateAsync(fn);
    await refresh(...keys);
    return out;
  };
  return {
    suspendUser: (id: string, reason: string) => run(() => adminApi.users.suspend(id, reason), "users", "stats"),
    unsuspendUser: (id: string) => run(() => adminApi.users.unsuspend(id), "users", "stats"),
    banUser: (id: string, reason: string) => run(() => adminApi.users.ban(id, reason), "users", "stats"),
    unbanUser: (id: string) => run(() => adminApi.users.unban(id), "users", "stats"),
    flagEvent: (id: string, reason: string) => run(() => adminApi.events.flag(id, reason), "events", "stats"),
    unflagEvent: (id: string) => run(() => adminApi.events.unflag(id), "events", "stats"),
    endEvent: (id: string) => run(() => adminApi.events.end(id), "events", "stats"),
    flagTransaction: (id: string, reason: string) => run(() => adminApi.transactions.flag(id, reason), "transactions", "stats"),
    unflagTransaction: (id: string) => run(() => adminApi.transactions.unflag(id), "transactions", "stats"),
    refundTransaction: (id: string, reason?: string) => run(() => adminApi.transactions.refund(id, reason), "transactions", "stats"),
    checkPayout: (id: string) => run(() => adminApi.payouts.check(id), "payouts", "transactions", "stats", "queue", "payments"),
    resolvePayout: (id: string, outcome: "paid" | "failed", reason: string, confirm: string) =>
      run(() => adminApi.payouts.resolve(id, outcome, reason, confirm), "payouts", "transactions", "stats", "queue", "payments"),
    checkBundleOrder: (id: string) => run(() => adminApi.bundleOrders.check(id), "bundleOrders", "transactions", "stats", "queue", "payments"),
    recordBundleRefund: (id: string, reference: string, amountNaira: number, note: string) =>
      run(() => adminApi.bundleOrders.refund(id, reference, Math.round(amountNaira * 100), note), "bundleOrders", "queue", "payments"),
  };
}
