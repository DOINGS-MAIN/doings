import { useState, useEffect } from "react";
import { motion, AnimatePresence } from "framer-motion";
import { Trophy, Sparkles, Gift } from "lucide-react";
import { useLeaderboard, LeaderboardEntry, TimePeriod } from "@/hooks/useLeaderboard";
import { TopGiftersPodium } from "@/components/leaderboard/TopGiftersPodium";
import { GifterRankingItem } from "@/components/leaderboard/GifterRankingItem";
import { UserStatsCard } from "@/components/leaderboard/UserStatsCard";

const periodLabels: Record<TimePeriod, string> = {
  weekly: 'This Week',
  monthly: 'This Month',
  allTime: 'All Time',
};

export const LeaderboardScreen = () => {
  const [period, setPeriod] = useState<TimePeriod>('weekly');
  const [leaderboard, setLeaderboard] = useState<LeaderboardEntry[]>([]);
  const [isLoading, setIsLoading] = useState(true);
  const { getLeaderboard, getTopThree, currentUserSprayTotal, currentUserGiveawayTotal, currentUserTotalGifted } = useLeaderboard();

  useEffect(() => {
    setIsLoading(true);
    const timer = setTimeout(() => {
      setLeaderboard(getLeaderboard(period));
      setIsLoading(false);
    }, 300);
    return () => clearTimeout(timer);
  }, [period]);

  const topThree = getTopThree(period);
  const currentUserEntry = leaderboard.find(e => e.isCurrentUser);

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

      {/* User Stats Card */}
      {currentUserEntry && (
        <UserStatsCard
          rank={currentUserEntry.rank}
          totalGifted={currentUserTotalGifted || currentUserEntry.totalGifted}
          sprayAmount={currentUserSprayTotal || currentUserEntry.sprayAmount}
          giveawayAmount={currentUserGiveawayTotal || currentUserEntry.giveawayAmount}
        />
      )}

      {/* Top 3 Podium */}
      <AnimatePresence mode="sync">
        {!isLoading && topThree.length >= 3 && (
          <motion.div key={period + '-podium'}>
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
              key={period + '-list'}
              initial={{ opacity: 0 }}
              animate={{ opacity: 1 }}
              exit={{ opacity: 0 }}
              className="space-y-2"
            >
              {leaderboard.slice(3).map((entry, index) => (
                <GifterRankingItem key={entry.id} entry={entry} index={index} />
              ))}
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
