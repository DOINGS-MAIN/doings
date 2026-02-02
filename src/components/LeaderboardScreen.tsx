import { useState, useEffect } from "react";
import { motion, AnimatePresence } from "framer-motion";
import { Trophy, Medal, Crown, TrendingUp, TrendingDown, Minus, Sparkles, Calendar } from "lucide-react";
import { useLeaderboard, LeaderboardEntry } from "@/hooks/useLeaderboard";

type TimePeriod = 'weekly' | 'monthly' | 'allTime';

const periodLabels: Record<TimePeriod, string> = {
  weekly: 'This Week',
  monthly: 'This Month',
  allTime: 'All Time',
};

export const LeaderboardScreen = () => {
  const [period, setPeriod] = useState<TimePeriod>('weekly');
  const [leaderboard, setLeaderboard] = useState<LeaderboardEntry[]>([]);
  const [isLoading, setIsLoading] = useState(true);
  const { getLeaderboard, getTopThree } = useLeaderboard();

  useEffect(() => {
    setIsLoading(true);
    // Simulate loading for animation effect
    const timer = setTimeout(() => {
      setLeaderboard(getLeaderboard(period));
      setIsLoading(false);
    }, 300);
    return () => clearTimeout(timer);
  }, [period]);

  const topThree = getTopThree(period);

  const getRankIcon = (rank: number) => {
    switch (rank) {
      case 1:
        return <Crown className="w-5 h-5 text-yellow-400" />;
      case 2:
        return <Medal className="w-5 h-5 text-gray-300" />;
      case 3:
        return <Medal className="w-5 h-5 text-amber-600" />;
      default:
        return <span className="text-sm font-bold text-muted-foreground">#{rank}</span>;
    }
  };

  const getRankChangeIcon = (change: LeaderboardEntry['rankChange']) => {
    switch (change) {
      case 'up':
        return <TrendingUp className="w-4 h-4 text-green-500" />;
      case 'down':
        return <TrendingDown className="w-4 h-4 text-red-500" />;
      default:
        return <Minus className="w-4 h-4 text-muted-foreground" />;
    }
  };

  const getPodiumHeight = (rank: number) => {
    switch (rank) {
      case 1: return 'h-28';
      case 2: return 'h-20';
      case 3: return 'h-16';
      default: return 'h-12';
    }
  };

  const getPodiumGradient = (rank: number) => {
    switch (rank) {
      case 1: return 'from-yellow-500 to-amber-600';
      case 2: return 'from-gray-300 to-gray-400';
      case 3: return 'from-amber-600 to-amber-700';
      default: return 'from-primary to-accent';
    }
  };

  return (
    <div className="space-y-6 pb-24">
      {/* Header */}
      <div className="text-center">
        <motion.div
          initial={{ scale: 0 }}
          animate={{ scale: 1 }}
          className="inline-flex items-center justify-center w-16 h-16 rounded-full bg-gradient-to-br from-yellow-400 to-amber-600 mb-3"
        >
          <Trophy className="w-8 h-8 text-white" />
        </motion.div>
        <h1 className="text-2xl font-black text-foreground">Leaderboard</h1>
        <p className="text-sm text-muted-foreground">Top sprayers in the community</p>
      </div>

      {/* Period Filters */}
      <div className="flex gap-2 p-1 bg-muted rounded-2xl">
        {(Object.keys(periodLabels) as TimePeriod[]).map((p) => (
          <motion.button
            key={p}
            onClick={() => setPeriod(p)}
            className={`flex-1 py-3 px-4 rounded-xl text-sm font-medium transition-colors ${
              period === p
                ? 'bg-primary text-primary-foreground'
                : 'text-muted-foreground hover:text-foreground'
            }`}
            whileTap={{ scale: 0.98 }}
          >
            {periodLabels[p]}
          </motion.button>
        ))}
      </div>

      {/* Top 3 Podium */}
      <AnimatePresence mode="wait">
        {!isLoading && topThree.length >= 3 && (
          <motion.div
            key={period + '-podium'}
            initial={{ opacity: 0, y: 20 }}
            animate={{ opacity: 1, y: 0 }}
            exit={{ opacity: 0, y: -20 }}
            className="flex items-end justify-center gap-3 h-52 px-4"
          >
            {/* 2nd Place */}
            <div className="flex flex-col items-center flex-1">
              <motion.div
                initial={{ scale: 0 }}
                animate={{ scale: 1 }}
                transition={{ delay: 0.2 }}
                className="relative mb-2"
              >
                <div className="w-16 h-16 rounded-full bg-gradient-to-br from-gray-200 to-gray-400 flex items-center justify-center text-3xl border-4 border-gray-300">
                  {topThree[1]?.avatar}
                </div>
                <div className="absolute -bottom-1 -right-1 w-6 h-6 rounded-full bg-gray-300 flex items-center justify-center">
                  <span className="text-xs font-black text-gray-700">2</span>
                </div>
              </motion.div>
              <p className="text-sm font-bold text-foreground truncate max-w-[80px]">{topThree[1]?.name}</p>
              <p className="text-xs text-muted-foreground">₦{topThree[1]?.totalSprayed.toLocaleString()}</p>
              <motion.div
                initial={{ height: 0 }}
                animate={{ height: 'auto' }}
                transition={{ delay: 0.3 }}
                className={`w-full ${getPodiumHeight(2)} bg-gradient-to-t ${getPodiumGradient(2)} rounded-t-xl mt-2`}
              />
            </div>

            {/* 1st Place */}
            <div className="flex flex-col items-center flex-1">
              <motion.div
                initial={{ scale: 0, rotate: -10 }}
                animate={{ scale: 1, rotate: 0 }}
                transition={{ delay: 0.1, type: "spring" }}
                className="relative mb-2"
              >
                <Sparkles className="absolute -top-2 -right-2 w-6 h-6 text-yellow-400 animate-pulse" />
                <div className="w-20 h-20 rounded-full bg-gradient-to-br from-yellow-300 to-amber-500 flex items-center justify-center text-4xl border-4 border-yellow-400 shadow-lg shadow-yellow-500/30">
                  {topThree[0]?.avatar}
                </div>
                <div className="absolute -bottom-1 -right-1 w-7 h-7 rounded-full bg-yellow-400 flex items-center justify-center">
                  <Crown className="w-4 h-4 text-yellow-800" />
                </div>
              </motion.div>
              <p className="text-sm font-black text-foreground truncate max-w-[90px]">{topThree[0]?.name}</p>
              <p className="text-xs font-bold text-primary">₦{topThree[0]?.totalSprayed.toLocaleString()}</p>
              <motion.div
                initial={{ height: 0 }}
                animate={{ height: 'auto' }}
                transition={{ delay: 0.2 }}
                className={`w-full ${getPodiumHeight(1)} bg-gradient-to-t ${getPodiumGradient(1)} rounded-t-xl mt-2`}
              />
            </div>

            {/* 3rd Place */}
            <div className="flex flex-col items-center flex-1">
              <motion.div
                initial={{ scale: 0 }}
                animate={{ scale: 1 }}
                transition={{ delay: 0.3 }}
                className="relative mb-2"
              >
                <div className="w-14 h-14 rounded-full bg-gradient-to-br from-amber-500 to-amber-700 flex items-center justify-center text-2xl border-4 border-amber-600">
                  {topThree[2]?.avatar}
                </div>
                <div className="absolute -bottom-1 -right-1 w-6 h-6 rounded-full bg-amber-600 flex items-center justify-center">
                  <span className="text-xs font-black text-amber-100">3</span>
                </div>
              </motion.div>
              <p className="text-sm font-bold text-foreground truncate max-w-[70px]">{topThree[2]?.name}</p>
              <p className="text-xs text-muted-foreground">₦{topThree[2]?.totalSprayed.toLocaleString()}</p>
              <motion.div
                initial={{ height: 0 }}
                animate={{ height: 'auto' }}
                transition={{ delay: 0.4 }}
                className={`w-full ${getPodiumHeight(3)} bg-gradient-to-t ${getPodiumGradient(3)} rounded-t-xl mt-2`}
              />
            </div>
          </motion.div>
        )}
      </AnimatePresence>

      {/* Full Rankings List */}
      <div className="space-y-2">
        <div className="flex items-center gap-2 mb-3">
          <Calendar className="w-4 h-4 text-muted-foreground" />
          <span className="text-sm font-medium text-muted-foreground">{periodLabels[period]} Rankings</span>
        </div>

        <AnimatePresence mode="wait">
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
                <motion.div
                  key={entry.id}
                  initial={{ opacity: 0, x: -20 }}
                  animate={{ opacity: 1, x: 0 }}
                  transition={{ delay: index * 0.05 }}
                  className={`flex items-center gap-3 p-3 rounded-2xl ${
                    entry.isCurrentUser
                      ? 'bg-gradient-to-r from-primary/20 to-accent/20 border border-primary/30'
                      : 'bg-card border border-border'
                  }`}
                >
                  {/* Rank */}
                  <div className="w-10 h-10 rounded-xl bg-muted flex items-center justify-center">
                    {getRankIcon(entry.rank)}
                  </div>

                  {/* Avatar */}
                  <div className="w-12 h-12 rounded-full bg-gradient-to-br from-primary/20 to-accent/20 flex items-center justify-center text-2xl">
                    {entry.avatar}
                  </div>

                  {/* Info */}
                  <div className="flex-1 min-w-0">
                    <div className="flex items-center gap-2">
                      <p className="font-bold text-foreground truncate">
                        {entry.name}
                        {entry.isCurrentUser && (
                          <span className="text-xs text-primary ml-1">(You)</span>
                        )}
                      </p>
                      {getRankChangeIcon(entry.rankChange)}
                    </div>
                    <p className="text-xs text-muted-foreground">{entry.username}</p>
                  </div>

                  {/* Amount */}
                  <div className="text-right">
                    <p className="font-bold text-foreground">₦{entry.totalSprayed.toLocaleString()}</p>
                    <p className="text-xs text-muted-foreground">{entry.eventsAttended} events</p>
                  </div>
                </motion.div>
              ))}
            </motion.div>
          )}
        </AnimatePresence>
      </div>

      {/* Current User Card (if not in top 10) */}
      {leaderboard.find(e => e.isCurrentUser && e.rank > 10) && (
        <motion.div
          initial={{ opacity: 0, y: 20 }}
          animate={{ opacity: 1, y: 0 }}
          className="fixed bottom-20 left-4 right-4 p-4 rounded-2xl bg-gradient-to-r from-primary to-accent"
        >
          <div className="flex items-center gap-3">
            <div className="w-12 h-12 rounded-full bg-white/20 flex items-center justify-center text-2xl">
              🏆
            </div>
            <div className="flex-1">
              <p className="font-bold text-primary-foreground">Your Rank: #{leaderboard.find(e => e.isCurrentUser)?.rank}</p>
              <p className="text-sm text-primary-foreground/80">Keep spraying to climb up!</p>
            </div>
          </div>
        </motion.div>
      )}
    </div>
  );
};
