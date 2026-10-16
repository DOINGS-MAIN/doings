import { keepPreviousData, useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { admin as adminApi } from "@/lib/supabase";
import { useAdminAuth } from "@/hooks/useAdminAuth";
import { can } from "@/types/admin";
import { mapEvent, mapKyc, mapStats, mapTransaction, mapUser } from "@/lib/adminMappers";

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

export function useAdminMutations() {
  const qc = useQueryClient();
  const refresh = (...keys: (keyof typeof adminKeys)[]) =>
    Promise.all(keys.map((k) => qc.invalidateQueries({ queryKey: ["admin", k] })));
  const m = useMutation({ mutationFn: (fn: () => Promise<unknown>) => fn() });
  const run = async (fn: () => Promise<unknown>, ...keys: (keyof typeof adminKeys)[]) => {
    await m.mutateAsync(fn);
    await refresh(...keys);
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
  };
}
