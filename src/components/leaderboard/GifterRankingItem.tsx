import { motion } from "framer-motion";
import { Crown, Medal, TrendingUp, TrendingDown, Minus, Gift, Sparkles } from "lucide-react";
import { LeaderboardEntry } from "@/hooks/useLeaderboard";

interface GifterRankingItemProps {
  entry: LeaderboardEntry;
  index: number;
}

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

export const GifterRankingItem = ({ entry, index }: GifterRankingItemProps) => {
  return (
    <motion.div
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
        <div className="flex items-center gap-2 text-xs text-muted-foreground">
          <span className="flex items-center gap-1">
            <Sparkles className="w-3 h-3" />
            ₦{entry.sprayAmount.toLocaleString()}
          </span>
          <span>•</span>
          <span className="flex items-center gap-1">
            <Gift className="w-3 h-3" />
            ₦{entry.giveawayAmount.toLocaleString()}
          </span>
        </div>
      </div>

      {/* Amount */}
      <div className="text-right">
        <p className="font-bold text-foreground">₦{entry.totalGifted.toLocaleString()}</p>
        <p className="text-xs text-muted-foreground">{entry.eventsAttended} events</p>
      </div>
    </motion.div>
  );
};
