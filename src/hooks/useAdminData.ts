import { useState, useEffect, useCallback, useRef } from "react";
import { admin as adminApi, supabase } from "@/lib/supabase";
import { toast } from "sonner";
import {
  AdminUser,
  PlatformUser,
  AdminTransaction,
  KYCSubmission,
  AdminEvent,
  AdminStats,
  AdminRole,
} from "@/types/admin";

export type TransactionListParams = {
  page?: number;
  limit?: number;
  status?: string;
  type?: string;
  provider?: string;
  currency?: string;
  flagged?: string;
  search?: string;
};

interface AdminDataState {
  currentAdmin: AdminUser | null;
  users: PlatformUser[];
  transactions: AdminTransaction[];
  kycSubmissions: KYCSubmission[];
  events: AdminEvent[];
}

function mapTransaction(t: Record<string, unknown>): AdminTransaction {
  const currency = ((t.currency as string) ?? "NGN") as "NGN" | "USDT";
  const divisor = currency === "USDT" ? 1_000_000 : 100;
  const rawFee = Number(t.fee ?? 0);
  const rawAmount = Number(t.amount ?? 0);
  const rawNet = Number(t.net_amount ?? 0);
  const metadata = t.metadata as Record<string, unknown> | undefined;
  const feeBreakdown = metadata?.fee_breakdown as { total_fee_kobo?: number } | undefined;
  const inferredFeeKobo = rawFee > 0
    ? rawFee
    : Number(feeBreakdown?.total_fee_kobo ?? 0) > 0
    ? Number(feeBreakdown?.total_fee_kobo)
    : Math.max(Math.abs(rawNet) - Math.abs(rawAmount), 0);

  return {
    id: t.id as string,
    userId: (t.user_id as string) ?? "",
    userName: (t.user_name as string) ?? "",
    type: (t.type as AdminTransaction["type"]) ?? "deposit",
    amount: rawAmount / divisor,
    fee: inferredFeeKobo / divisor,
    netAmount: rawNet / divisor,
    currency,
    status: (t.status as AdminTransaction["status"]) ?? "pending",
    provider: (t.provider as string) ?? undefined,
    reference: (t.idempotency_key as string) ?? (t.provider_ref as string) ?? (t.id as string),
    description: (t.description as string) ?? "",
    metadata,
    createdAt: new Date((t.created_at as string) ?? Date.now()),
    processedAt: t.completed_at ? new Date(t.completed_at as string) : undefined,
    flagged: (t.flagged as boolean) ?? false,
    flagReason: (t.flag_reason as string) ?? undefined,
  };
}

export const useAdminData = () => {
  const [state, setState] = useState<AdminDataState>({
    currentAdmin: null,
    users: [],
    transactions: [],
    kycSubmissions: [],
    events: [],
  });
  const [platformStats, setPlatformStats] = useState<AdminStats | null>(null);
  const [transactionTotal, setTransactionTotal] = useState(0);
  const [transactionPage, setTransactionPage] = useState(1);
  const [loading, setLoading] = useState(true);
  const [transactionsLoading, setTransactionsLoading] = useState(false);
  const lastErrorRef = useRef<string | null>(null);

  const reportError = useCallback((message: string) => {
    if (lastErrorRef.current === message) return;
    lastErrorRef.current = message;
    toast.error(message);
  }, []);

  const fetchTransactions = useCallback(async (params: TransactionListParams = {}) => {
    setTransactionsLoading(true);
    try {
      const page = params.page ?? 1;
      const res = (await adminApi.transactions.list({
        page,
        limit: params.limit ?? 50,
        status: params.status && params.status !== "all" ? params.status : undefined,
        type: params.type && params.type !== "all" ? params.type : undefined,
        provider: params.provider && params.provider !== "all" ? params.provider : undefined,
        currency: params.currency && params.currency !== "all" ? params.currency : undefined,
        flagged: params.flagged && params.flagged !== "all" ? params.flagged : undefined,
        search: params.search?.trim() || undefined,
      })) as { transactions?: Record<string, unknown>[]; total?: number; page?: number };

      const txns = res.transactions ?? [];
      setTransactionTotal(res.total ?? txns.length);
      setTransactionPage(res.page ?? page);
      setState((prev) => ({
        ...prev,
        transactions: txns.map(mapTransaction),
      }));
      lastErrorRef.current = null;
    } catch (err) {
      reportError(err instanceof Error ? err.message : "Failed to load transactions");
    } finally {
      setTransactionsLoading(false);
    }
  }, [reportError]);

  const fetchStats = useCallback(async () => {
    const s = (await adminApi.stats()) as Record<string, number>;
    const totalFeeKobo = s.totalFeeRevenue ?? s.total_fee_revenue ?? 0;
    const todayFeeKobo = s.todayFeeRevenue ?? s.today_fee_revenue ?? 0;
    setPlatformStats({
      totalUsers: s.totalUsers ?? 0,
      activeUsers: s.activeUsers ?? 0,
      suspendedUsers: s.suspendedUsers ?? 0,
      pendingKYC: s.pendingKYC ?? 0,
      totalTransactions: s.totalTransactions ?? 0,
      totalVolume: (s.totalVolume ?? 0) / 100,
      todayVolume: (s.todayVolume ?? 0) / 100,
      totalFeeRevenue: totalFeeKobo / 100,
      todayFeeRevenue: todayFeeKobo / 100,
      activeEvents: s.activeEvents ?? 0,
      totalEvents: s.totalEvents ?? 0,
      flaggedTransactions: 0,
    });
  }, []);

  const fetchAll = useCallback(async () => {
    setLoading(true);
    try {
      const [statsRes, usersRes, kycRes, eventsRes] = await Promise.allSettled([
        adminApi.stats(),
        adminApi.users.list({ limit: 50 }),
        adminApi.kyc.list(),
        adminApi.events.list(),
      ]);

      if (statsRes.status === "fulfilled" && statsRes.value) {
        const s = statsRes.value as Record<string, number>;
        const totalFeeKobo = s.totalFeeRevenue ?? s.total_fee_revenue ?? 0;
        const todayFeeKobo = s.todayFeeRevenue ?? s.today_fee_revenue ?? 0;
        setPlatformStats({
          totalUsers: s.totalUsers ?? 0,
          activeUsers: s.activeUsers ?? 0,
          suspendedUsers: s.suspendedUsers ?? 0,
          pendingKYC: s.pendingKYC ?? 0,
          totalTransactions: s.totalTransactions ?? 0,
          totalVolume: (s.totalVolume ?? 0) / 100,
          todayVolume: (s.todayVolume ?? 0) / 100,
          totalFeeRevenue: totalFeeKobo / 100,
          todayFeeRevenue: todayFeeKobo / 100,
          activeEvents: s.activeEvents ?? 0,
          totalEvents: s.totalEvents ?? 0,
          flaggedTransactions: 0,
        });
      }

      const users = usersRes.status === "fulfilled" ? (usersRes.value as { users: Record<string, unknown>[] })?.users ?? [] : [];
      const kycs = kycRes.status === "fulfilled" ? (kycRes.value as { submissions: Record<string, unknown>[] })?.submissions ?? [] : [];
      const evts = eventsRes.status === "fulfilled" ? (eventsRes.value as { events: Record<string, unknown>[] })?.events ?? [] : [];

      setState((prev) => ({
        ...prev,
        users: (users as Record<string, unknown>[]).map((u) => ({
          id: u.id as string,
          name: (u.full_name as string) ?? (u.name as string) ?? "",
          phone: (() => {
            const p = u.phone as string | null | undefined;
            return p && String(p).trim() ? String(p) : null;
          })(),
          email: (u.email as string) ?? "",
          walletBalance: (u.wallet_balance as number) ?? 0,
          totalSprayed: (u.total_sprayed as number) ?? 0,
          totalReceived: (u.total_received as number) ?? 0,
          eventsHosted: (u.events_hosted as number) ?? 0,
          eventsJoined: (u.events_joined as number) ?? 0,
          status: (u.status as PlatformUser["status"]) ?? "active",
          kycStatus: (u.kyc_status as PlatformUser["kycStatus"]) ?? "none",
          createdAt: new Date((u.created_at as string) ?? Date.now()),
          lastActive: new Date((u.last_active_at as string) ?? (u.last_active as string) ?? Date.now()),
        })),
        kycSubmissions: (kycs as Record<string, unknown>[]).map((k) => ({
          id: k.id as string,
          userId: (k.user_id as string) ?? "",
          userName: (k.user_name as string) ?? "",
          userPhone: (k.user_phone as string) ?? "",
          level: (k.level as number) ?? 0,
          bvn: (k.bvn as string) ?? "",
          nin: (k.nin as string) ?? "",
          idType: "national_id" as const,
          idNumber: "",
          idImageUrl: "",
          selfieUrl: (k.selfie_url as string) ?? "",
          status: (k.status as KYCSubmission["status"]) ?? "pending",
          submittedAt: new Date((k.created_at as string) ?? Date.now()),
          reviewedAt: k.reviewed_at ? new Date(k.reviewed_at as string) : undefined,
          reviewedBy: k.reviewed_by as string | undefined,
        })),
        events: (evts as Record<string, unknown>[]).map((e) => ({
          id: e.id as string,
          name: (e.title as string) ?? "",
          hostId: (e.host_id as string) ?? "",
          hostName: (e.host_name as string) ?? "",
          code: (e.event_code as string) ?? (e.code as string) ?? "",
          type: (e.type as AdminEvent["type"]) ?? "other",
          status: (e.status as AdminEvent["status"]) ?? "ended",
          participantCount: (e.participant_count as number) ?? 0,
          totalSprayed: ((e.total_sprayed as number) ?? 0) / 100,
          giveawayCount: (e.giveaway_count as number) ?? 0,
          createdAt: new Date((e.created_at as string) ?? Date.now()),
          scheduledAt: e.scheduled_start ? new Date(e.scheduled_start as string) : undefined,
          flagged: (e.flagged as boolean) ?? false,
          flagReason: e.flag_reason as string | undefined,
        })),
      }));

      await fetchTransactions({ page: 1, limit: 50 });
      lastErrorRef.current = null;
    } catch (err) {
      reportError(err instanceof Error ? err.message : "Failed to load admin data");
    } finally {
      setLoading(false);
    }
  }, [fetchTransactions, reportError]);

  useEffect(() => {
    fetchAll();
  }, [fetchAll]);

  useEffect(() => {
    const channel = supabase
      .channel("admin-transactions-live")
      .on(
        "postgres_changes",
        { event: "*", schema: "public", table: "transactions" },
        () => {
          void fetchTransactions({ page: transactionPage, limit: 50 });
          void fetchStats();
        },
      )
      .subscribe();

    return () => {
      void supabase.removeChannel(channel);
    };
  }, [fetchTransactions, fetchStats, transactionPage]);

  const getStats = useCallback((): AdminStats => {
    if (platformStats) {
      return {
        ...platformStats,
        flaggedTransactions: state.transactions.filter((t) => t.flagged).length,
      };
    }

    const { users, transactions, events, kycSubmissions } = state;
    const today = new Date();
    today.setHours(0, 0, 0, 0);

    return {
      totalUsers: users.length,
      activeUsers: users.filter((u) => u.status === "active").length,
      suspendedUsers: users.filter((u) => u.status === "suspended" || u.status === "banned").length,
      pendingKYC: kycSubmissions.filter((k) => k.status === "pending").length,
      totalTransactions: transactionTotal || transactions.length,
      totalVolume: transactions.filter((t) => t.status === "completed" && t.amount > 0).reduce((s, t) => s + t.amount, 0),
      todayVolume: transactions.filter((t) => t.createdAt >= today && t.amount > 0).reduce((s, t) => s + t.amount, 0),
      totalFeeRevenue: transactions
        .filter((t) => t.status === "completed" && (t.fee ?? 0) > 0)
        .reduce((s, t) => s + (t.fee ?? 0), 0),
      todayFeeRevenue: transactions
        .filter((t) => t.status === "completed" && t.createdAt >= today && (t.fee ?? 0) > 0)
        .reduce((s, t) => s + (t.fee ?? 0), 0),
      activeEvents: events.filter((e) => e.status === "live").length,
      totalEvents: events.length,
      flaggedTransactions: transactions.filter((t) => t.flagged).length,
    };
  }, [platformStats, state, transactionTotal]);

  const suspendUser = useCallback(async (userId: string, reason: string) => {
    await adminApi.users.suspend(userId, reason);
    await fetchAll();
  }, [fetchAll]);

  const unsuspendUser = useCallback(async (userId: string) => {
    await adminApi.users.unsuspend(userId);
    await fetchAll();
  }, [fetchAll]);

  const banUser = useCallback(async (userId: string, reason: string) => {
    await adminApi.users.ban(userId, reason);
    await fetchAll();
  }, [fetchAll]);

  const flagTransaction = useCallback(async (transactionId: string, reason: string) => {
    await adminApi.transactions.flag(transactionId, reason);
    await fetchTransactions({ page: transactionPage, limit: 50 });
  }, [fetchTransactions, transactionPage]);

  const refundTransaction = useCallback(async (transactionId: string, reason?: string) => {
    await adminApi.transactions.refund(transactionId, reason);
    await fetchAll();
  }, [fetchAll]);

  const unflagTransaction = useCallback(async (transactionId: string) => {
    await adminApi.transactions.unflag(transactionId);
    await fetchTransactions({ page: transactionPage, limit: 50 });
  }, [fetchTransactions, transactionPage]);

  const approveKYC = useCallback(async (kycId: string) => {
    await adminApi.kyc.approve(kycId);
    await fetchAll();
  }, [fetchAll]);

  const rejectKYC = useCallback(async (kycId: string, reason: string) => {
    await adminApi.kyc.reject(kycId, reason);
    await fetchAll();
  }, [fetchAll]);

  const endEvent = useCallback(async (eventId: string) => {
    await adminApi.events.end(eventId);
    await fetchAll();
  }, [fetchAll]);

  const flagEvent = useCallback(async (_eventId: string, _reason: string) => {
    await fetchAll();
  }, [fetchAll]);

  const unflagEvent = useCallback(async (_eventId: string) => {
    await fetchAll();
  }, [fetchAll]);

  const setAdminRole = useCallback((_role: AdminRole) => {}, []);

  return {
    currentAdmin: state.currentAdmin,
    users: state.users,
    transactions: state.transactions,
    kycSubmissions: state.kycSubmissions,
    events: state.events,
    loading,
    transactionsLoading,
    transactionTotal,
    transactionPage,
    fetchTransactions,
    getStats,
    suspendUser,
    unsuspendUser,
    banUser,
    refundTransaction,
    flagTransaction,
    unflagTransaction,
    approveKYC,
    rejectKYC,
    flagEvent,
    unflagEvent,
    endEvent,
    setAdminRole,
    refresh: fetchAll,
  };
};
