import { useState, useEffect, useCallback } from "react";
import { admin as adminApi } from "@/lib/supabase";
import {
  AdminUser,
  PlatformUser,
  AdminTransaction,
  KYCSubmission,
  AdminEvent,
  AdminStats,
  AdminRole,
} from "@/types/admin";

interface AdminDataState {
  currentAdmin: AdminUser | null;
  users: PlatformUser[];
  transactions: AdminTransaction[];
  kycSubmissions: KYCSubmission[];
  events: AdminEvent[];
}

export const useAdminData = () => {
  const [state, setState] = useState<AdminDataState>({
    currentAdmin: null,
    users: [],
    transactions: [],
    kycSubmissions: [],
    events: [],
  });
  const [loading, setLoading] = useState(true);

  const fetchAll = useCallback(async () => {
    setLoading(true);
    try {
      const [statsRes, usersRes, txnsRes, kycRes, eventsRes] = await Promise.allSettled([
        adminApi.stats(),
        adminApi.users.list({ limit: 50 }),
        adminApi.transactions.list({ limit: 50 }),
        adminApi.kyc.list(),
        adminApi.events.list(),
      ]);

      const users = usersRes.status === "fulfilled" ? (usersRes.value as { users: Record<string, unknown>[] })?.users ?? [] : [];
      const txns = txnsRes.status === "fulfilled" ? (txnsRes.value as { transactions: Record<string, unknown>[] })?.transactions ?? [] : [];
      const kycs = kycRes.status === "fulfilled" ? (kycRes.value as { submissions: Record<string, unknown>[] })?.submissions ?? [] : [];
      const evts = eventsRes.status === "fulfilled" ? (eventsRes.value as { events: Record<string, unknown>[] })?.events ?? [] : [];

      setState({
        currentAdmin: null,
        users: (users as Record<string, unknown>[]).map((u) => ({
          id: u.id as string,
          name: (u.full_name as string) ?? (u.name as string) ?? "",
          phone: (u.phone as string) ?? "",
          email: (u.email as string) ?? "",
          walletBalance: (u.wallet_balance as number) ?? 0,
          totalSprayed: (u.total_sprayed as number) ?? 0,
          totalReceived: (u.total_received as number) ?? 0,
          eventsHosted: (u.events_hosted as number) ?? 0,
          eventsJoined: (u.events_joined as number) ?? 0,
          status: (u.status as PlatformUser["status"]) ?? "active",
          kycStatus: (u.kyc_status as PlatformUser["kycStatus"]) ?? "none",
          createdAt: new Date((u.created_at as string) ?? Date.now()),
          lastActive: new Date((u.last_active as string) ?? Date.now()),
        })),
        transactions: (txns as Record<string, unknown>[]).map((t) => ({
          id: t.id as string,
          userId: (t.sender_id as string) ?? (t.user_id as string) ?? "",
          userName: (t.user_name as string) ?? "",
          type: (t.type as AdminTransaction["type"]) ?? "deposit",
          amount: ((t.amount as number) ?? 0) / 100,
          currency: ((t.currency as string) ?? "NGN") as "NGN" | "USDT",
          status: (t.status as AdminTransaction["status"]) ?? "pending",
          provider: (t.provider as string) ?? "",
          description: (t.description as string) ?? "",
          createdAt: new Date((t.created_at as string) ?? Date.now()),
          flagged: (t.flagged as boolean) ?? false,
          flagReason: t.flag_reason as string | undefined,
        })),
        kycSubmissions: (kycs as Record<string, unknown>[]).map((k) => ({
          id: k.id as string,
          userId: (k.user_id as string) ?? "",
          userName: (k.user_name as string) ?? "",
          level: (k.level as number) ?? 0,
          bvn: (k.bvn as string) ?? "",
          nin: (k.nin as string) ?? "",
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
          code: (e.event_code as string) ?? "",
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
      });
    } catch {
      // API may not be accessible — keep empty state
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    fetchAll();
  }, [fetchAll]);

  const getStats = useCallback((): AdminStats => {
    const { users, transactions, events, kycSubmissions } = state;
    const today = new Date();
    today.setHours(0, 0, 0, 0);

    return {
      totalUsers: users.length,
      activeUsers: users.filter((u) => u.status === "active").length,
      suspendedUsers: users.filter((u) => u.status === "suspended" || u.status === "banned").length,
      pendingKYC: kycSubmissions.filter((k) => k.status === "pending").length,
      totalTransactions: transactions.length,
      totalVolume: transactions.filter((t) => t.status === "completed" && t.amount > 0).reduce((s, t) => s + t.amount, 0),
      todayVolume: transactions.filter((t) => t.createdAt >= today && t.amount > 0).reduce((s, t) => s + t.amount, 0),
      activeEvents: events.filter((e) => e.status === "live").length,
      totalEvents: events.length,
      flaggedTransactions: transactions.filter((t) => t.flagged).length,
    };
  }, [state]);

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
    await fetchAll();
  }, [fetchAll]);

  const refundTransaction = useCallback(async (_transactionId: string) => {
    await fetchAll();
  }, [fetchAll]);

  const unflagTransaction = useCallback(async (_transactionId: string) => {
    await fetchAll();
  }, [fetchAll]);

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
