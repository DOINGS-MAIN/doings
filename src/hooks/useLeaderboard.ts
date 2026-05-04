import { useCallback, useEffect, useMemo, useState } from "react";
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
      setError(qError.message);
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

  const currentUserSprayTotal = useMemo(() => {
    return transactions
      .filter((t) => t.currency === "NGN" && t.status === "completed" && t.type === "spray")
      .reduce((sum, t) => sum + Math.abs(t.amount), 0);
  }, [transactions]);

  const currentUserGiveawayTotal = useMemo(() => {
    return transactions
      .filter((t) => t.currency === "NGN" && t.status === "completed" && t.type === "giveaway")
      .reduce((sum, t) => sum + Math.abs(t.amount), 0);
  }, [transactions]);

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
