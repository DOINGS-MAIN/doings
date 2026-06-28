import { useState } from "react";
import { motion, AnimatePresence } from "framer-motion";
import { Trophy, Sparkles, Gift, RefreshCw } from "lucide-react";
import { useLeaderboard, TimePeriod } from "@/hooks/useLeaderboard";
import { TopGiftersPodium } from "@/components/leaderboard/TopGiftersPodium";
import { GifterRankingItem } from "@/components/leaderboard/GifterRankingItem";
import { UserStatsCard } from "@/components/leaderboard/UserStatsCard";

const periodLabels: Record<TimePeriod, string> = {
  weekly: 'This Week',
  monthly: 'This Month',
  allTime: 'All Time',
};

const statsScopeHints: Record<TimePeriod, string> = {
  weekly:
    "Your totals: completed NGN sprays and giveaways in the last 7 days (same window as this board).",
  monthly:
    "Your totals: completed NGN sprays and giveaways in the last 30 days (same window as this board).",
  allTime:
    "Your totals: completed NGN sprays and giveaways from your loaded history (up to 50 transactions).",
};

export const LeaderboardScreen = () => {
  const [period, setPeriod] = useState<TimePeriod>("weekly");
  const {
    leaderboard,
    loading: isLoading,
    error,
    isSupabaseConfigured,
    refetch,
    topThree,
    currentUserEntry,
    currentUserSprayTotal,
    currentUserGiveawayTotal,
    currentUserTotalGifted,
  } = useLeaderboard(period);

  const listStartIndex = topThree.length >= 3 ? 3 : 0;
  const listEntries = leaderboard.slice(listStartIndex);

  return (
    <div className="space-y-6 pb-24 px-4">
      {/* Header */}
      <div className="text-center pt-8">
        <motion.div
          initial={{ scale: 0 }}
          animate={{ scale: 1 }}
          className="inline-flex items-center justify-center w-16 h-16 rounded-full bg-gradient-to-br from-yellow-400 to-amber-600 mb-3 shadow-lg shadow-yellow-500/30"
        >
          <Trophy className="w-8 h-8 text-white" />
        </motion.div>
        <h1 className="text-2xl font-black text-foreground">Top Gifters</h1>
        <p className="text-sm text-muted-foreground flex items-center justify-center gap-2 mt-1">
          <Sparkles className="w-4 h-4" />
          Sprays + Giveaways
          <Gift className="w-4 h-4" />
        </p>
      </div>

      {/* Period Filters */}
      <div className="flex gap-2 p-1 bg-muted rounded-2xl">
        {(Object.keys(periodLabels) as TimePeriod[]).map((p) => (
          <motion.button
            key={p}
            onClick={() => setPeriod(p)}
            className={`flex-1 py-3 px-4 rounded-xl text-sm font-medium transition-colors ${
              period === p
                ? 'bg-primary text-primary-foreground shadow-lg'
                : 'text-muted-foreground hover:text-foreground'
            }`}
            whileTap={{ scale: 0.98 }}
          >
            {periodLabels[p]}
          </motion.button>
        ))}
      </div>

      {!isSupabaseConfigured && (
        <div className="rounded-2xl border border-amber-500/30 bg-amber-500/10 px-4 py-3 text-sm text-amber-900 dark:text-amber-100">
          <p className="font-medium">Leaderboard unavailable in this build</p>
          <p className="mt-1 opacity-90">
            Set <span className="font-mono text-xs">VITE_SUPABASE_URL</span> and{" "}
            <span className="font-mono text-xs">VITE_SUPABASE_ANON_KEY</span> at build time, then rebuild.
          </p>
        </div>
      )}

      {error && (
        <div className="rounded-2xl border border-destructive/30 bg-destructive/10 px-4 py-3 text-sm text-destructive">
          <p className="font-medium">Could not load leaderboard</p>
          <p className="mt-1 text-destructive/90">{error}</p>
          <button
            type="button"
            onClick={() => void refetch()}
            className="mt-3 inline-flex items-center gap-2 rounded-xl bg-destructive/20 px-3 py-2 font-semibold text-destructive"
          >
            <RefreshCw className="h-4 w-4" />
            Retry
          </button>
        </div>
      )}

      {/* User Stats Card — wallet totals; rank from materialized view when present */}
      <UserStatsCard
        rank={currentUserEntry?.rank ?? null}
        totalGifted={currentUserTotalGifted}
        sprayAmount={currentUserSprayTotal}
        giveawayAmount={currentUserGiveawayTotal}
        statsScopeHint={statsScopeHints[period]}
      />

      {/* Top 3 Podium */}
      <AnimatePresence mode="sync">
        {!isLoading && topThree.length >= 3 && (
          <motion.div key={period + "-podium"}>
            <TopGiftersPodium topThree={topThree} />
          </motion.div>
        )}
      </AnimatePresence>

      {/* Full Rankings List */}
      <div className="space-y-2">
        <div className="flex items-center gap-2 mb-3">
          <Trophy className="w-4 h-4 text-muted-foreground" />
          <span className="text-sm font-medium text-muted-foreground">{periodLabels[period]} Rankings</span>
        </div>

        {!isLoading && !error && isSupabaseConfigured && leaderboard.length === 0 && (
          <p className="rounded-2xl border border-white/10 bg-card/40 px-4 py-6 text-center text-sm text-muted-foreground mb-2">
            No gifters in this period yet. After people spray or run giveaways, rankings appear once the
            leaderboard refresh job has run (usually on a short schedule in production).
          </p>
        )}

        <AnimatePresence mode="sync">
          {isLoading ? (
            <motion.div
              key="loading"
              initial={{ opacity: 0 }}
              animate={{ opacity: 1 }}
              exit={{ opacity: 0 }}
              className="space-y-2"
            >
              {[...Array(5)].map((_, i) => (
                <div key={i} className="h-16 rounded-2xl bg-muted animate-pulse" />
              ))}
            </motion.div>
          ) : (
            <motion.div
              key={period + "-list"}
              initial={{ opacity: 0 }}
              animate={{ opacity: 1 }}
              exit={{ opacity: 0 }}
              className="space-y-2"
            >
              {listEntries.length === 0 ? (
                leaderboard.length > 0 ? (
                  <p className="rounded-2xl border border-white/10 bg-card/40 px-4 py-8 text-center text-sm text-muted-foreground">
                    Everyone in the top 3 is on the podium — there are no additional ranks to list.
                  </p>
                ) : null
              ) : (
                listEntries.map((entry, index) => (
                  <GifterRankingItem key={entry.id} entry={entry} index={index} />
                ))
              )}
            </motion.div>
          )}
        </AnimatePresence>
      </div>

      {/* Current User Card (if not in top 10) */}
      {currentUserEntry && currentUserEntry.rank > 10 && (
        <motion.div
          initial={{ opacity: 0, y: 20 }}
          animate={{ opacity: 1, y: 0 }}
          className="fixed bottom-20 left-4 right-4 p-4 rounded-2xl bg-gradient-to-r from-primary to-accent shadow-xl"
        >
          <div className="flex items-center gap-3">
            <div className="w-12 h-12 rounded-full bg-white/20 flex items-center justify-center text-2xl">
              🏆
            </div>
            <div className="flex-1">
              <p className="font-bold text-primary-foreground">Your Rank: #{currentUserEntry.rank}</p>
              <p className="text-sm text-primary-foreground/80">Keep gifting to climb up!</p>
            </div>
          </div>
        </motion.div>
      )}
    </div>
  );
};
