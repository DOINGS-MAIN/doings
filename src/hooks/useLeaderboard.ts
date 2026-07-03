import { useCallback, useEffect, useMemo, useState } from "react";
import type { PostgrestError } from "@supabase/supabase-js";
import { supabase, isSupabaseConfigured } from "@/lib/supabase";
import { useAuth } from "@/hooks/useAuth";
import { useMultiWallet } from "@/hooks/useMultiWallet";

export interface LeaderboardEntry {
  id: string;
  rank: number;
  name: string;
  username: string;
  /** Fallback emoji / letter when no photo */
  avatar: string;
  avatarUrl: string | null;
  totalGifted: number;
  sprayAmount: number;
  giveawayAmount: number;
  eventsAttended: number;
  isCurrentUser: boolean;
  previousRank?: number;
  rankChange: "up" | "down" | "same" | "new";
}

export type TimePeriod = "weekly" | "monthly" | "allTime";

const VIEW_BY_PERIOD: Record<TimePeriod, string> = {
  weekly: "leaderboard_weekly",
  monthly: "leaderboard_monthly",
  allTime: "leaderboard_alltime",
};

/** Match materialized view windows (`INTERVAL '7 days'` / `'30 days'`). */
function periodStartDate(period: TimePeriod): Date | null {
  if (period === "weekly") return new Date(Date.now() - 7 * 24 * 60 * 60 * 1000);
  if (period === "monthly") return new Date(Date.now() - 30 * 24 * 60 * 60 * 1000);
  return null;
}

function humanizeLeaderboardError(err: PostgrestError): string {
  const msg = (err.message ?? "").trim();
  const code = err.code ?? "";
  const combined = `${msg} ${err.details ?? ""}`.toLowerCase();

  if (
    code === "42501" ||
    combined.includes("permission denied") ||
    combined.includes("insufficient privilege")
  ) {
    return "You don’t have access to the leaderboard. Try signing out and back in. If it continues, contact support.";
  }
  if (combined.includes("jwt") && (combined.includes("expired") || combined.includes("invalid"))) {
    return "Your session is invalid or expired. Please sign in again.";
  }
  if (code === "401" || combined.includes("not authenticated")) {
    return "You need to be signed in to view the leaderboard.";
  }
  if (code === "42P01" || /\bdoes not exist\b/i.test(msg)) {
    return "Leaderboard tables are missing. The team may need to apply database migrations.";
  }
  return msg || "Something went wrong loading the leaderboard.";
}

function koboToNaira(kobo: unknown): number {
  const n = Number(kobo);
  if (!Number.isFinite(n)) return 0;
  return n / 100;
}

function displayAvatarEmoji(fullName: string, hasPhoto: boolean): string {
  if (hasPhoto) return "";
  const ch = fullName.trim().charAt(0);
  return ch ? ch.toUpperCase() : "👤";
}

function mapRow(row: Record<string, unknown>, appUserId: string | undefined): LeaderboardEntry {
  const userId = String(row.user_id ?? "");
  const fullName = (row.full_name as string)?.trim() || "Member";
  const usernameRaw = ((row.username as string) ?? "").trim();
  const avatarUrl = ((row.avatar_url as string) ?? "").trim() || null;
  const rank = Number(row.rank) || 0;

  return {
    id: userId,
    rank,
    name: fullName,
    username: usernameRaw ? `@${usernameRaw}` : "",
    avatar: displayAvatarEmoji(fullName, Boolean(avatarUrl)),
    avatarUrl,
    sprayAmount: koboToNaira(row.spray_total),
    giveawayAmount: koboToNaira(row.giveaway_total),
    totalGifted: koboToNaira(row.total_gifted),
    eventsAttended: Number(row.events_attended) || 0,
    isCurrentUser: Boolean(appUserId && userId === appUserId),
    rankChange: "same",
  };
}

export function useLeaderboard(period: TimePeriod) {
  const { profile } = useAuth();
  const { transactions } = useMultiWallet();

  const [leaderboard, setLeaderboard] = useState<LeaderboardEntry[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  const fetchLeaderboard = useCallback(async () => {
    if (!isSupabaseConfigured) {
      setLeaderboard([]);
      setError(null);
      setLoading(false);
      return;
    }

    setLoading(true);
    setError(null);

    const view = VIEW_BY_PERIOD[period];
    const { data, error: qError } = await supabase
      .from(view)
      .select("user_id, full_name, username, avatar_url, spray_total, giveaway_total, total_gifted, events_attended, rank")
      .order("rank", { ascending: true })
      .limit(100);

    if (qError) {
      setError(humanizeLeaderboardError(qError));
      setLeaderboard([]);
    } else {
      const rows = (data ?? []) as Record<string, unknown>[];
      setLeaderboard(rows.map((r) => mapRow(r, profile?.id)));
    }
    setLoading(false);
  }, [period, profile?.id]);

  useEffect(() => {
    void fetchLeaderboard();
  }, [fetchLeaderboard]);

  const periodCutoff = useMemo(() => periodStartDate(period), [period]);

  const transactionsInPeriod = useMemo(() => {
    if (!periodCutoff) return transactions;
    return transactions.filter((t) => t.createdAt >= periodCutoff);
  }, [transactions, periodCutoff]);

  const currentUserSprayTotal = useMemo(() => {
    return transactionsInPeriod
      .filter((t) => t.currency === "NGN" && t.status === "completed" && t.type === "spray")
      .reduce((sum, t) => sum + Math.abs(t.amount), 0);
  }, [transactionsInPeriod]);

  const currentUserGiveawayTotal = useMemo(() => {
    return transactionsInPeriod
      .filter((t) => t.currency === "NGN" && t.status === "completed" && t.type === "giveaway")
      .reduce((sum, t) => sum + Math.abs(t.amount), 0);
  }, [transactionsInPeriod]);

  const currentUserTotalGifted = currentUserSprayTotal + currentUserGiveawayTotal;

  const topThree = useMemo(() => leaderboard.slice(0, 3), [leaderboard]);

  const currentUserEntry = useMemo(
    () => leaderboard.find((e) => e.isCurrentUser),
    [leaderboard]
  );

  const getLeaderboard = useCallback(() => leaderboard, [leaderboard]);
  const getTopThree = useCallback(() => topThree, [topThree]);
  const getCurrentUserRank = useCallback(() => currentUserEntry, [currentUserEntry]);

  return {
    leaderboard,
    loading,
    error,
    isSupabaseConfigured,
    refetch: fetchLeaderboard,
    topThree,
    currentUserEntry,
    currentUserSprayTotal,
    currentUserGiveawayTotal,
    currentUserTotalGifted,
    getLeaderboard,
    getTopThree,
    getCurrentUserRank,
  };
}
