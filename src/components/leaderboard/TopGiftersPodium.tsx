import { motion } from "framer-motion";
import { Crown, Sparkles } from "lucide-react";
import { LeaderboardEntry } from "@/hooks/useLeaderboard";

interface TopGiftersPodiumProps {
  topThree: LeaderboardEntry[];
}

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

export const TopGiftersPodium = ({ topThree }: TopGiftersPodiumProps) => {
  if (topThree.length < 3) return null;

  return (
    <motion.div
      initial={{ opacity: 0, y: 20 }}
      animate={{ opacity: 1, y: 0 }}
      exit={{ opacity: 0, y: -20 }}
      className="flex items-end justify-center gap-3 h-56 px-4"
    >
      {/* 2nd Place */}
      <div className="flex flex-col items-center flex-1">
        <motion.div
          initial={{ scale: 0 }}
          animate={{ scale: 1 }}
          transition={{ delay: 0.2 }}
          className="relative mb-2"
        >
          <div className="w-16 h-16 rounded-full bg-gradient-to-br from-gray-200 to-gray-400 flex items-center justify-center text-3xl border-4 border-gray-300 shadow-lg">
            {topThree[1]?.avatar}
          </div>
          <div className="absolute -bottom-1 -right-1 w-6 h-6 rounded-full bg-gray-300 flex items-center justify-center shadow-md">
            <span className="text-xs font-black text-gray-700">2</span>
          </div>
        </motion.div>
        <p className="text-sm font-bold text-foreground truncate max-w-[80px]">{topThree[1]?.name}</p>
        <p className="text-xs text-muted-foreground">₦{topThree[1]?.totalGifted.toLocaleString()}</p>
        <motion.div
          initial={{ height: 0 }}
          animate={{ height: 'auto' }}
          transition={{ delay: 0.3 }}
          className={`w-full ${getPodiumHeight(2)} bg-gradient-to-t ${getPodiumGradient(2)} rounded-t-xl mt-2 shadow-lg`}
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
          <div className="w-20 h-20 rounded-full bg-gradient-to-br from-yellow-300 to-amber-500 flex items-center justify-center text-4xl border-4 border-yellow-400 shadow-xl shadow-yellow-500/30">
            {topThree[0]?.avatar}
          </div>
          <div className="absolute -bottom-1 -right-1 w-7 h-7 rounded-full bg-yellow-400 flex items-center justify-center shadow-md">
            <Crown className="w-4 h-4 text-yellow-800" />
          </div>
        </motion.div>
        <p className="text-sm font-black text-foreground truncate max-w-[90px]">{topThree[0]?.name}</p>
        <p className="text-xs font-bold text-primary">₦{topThree[0]?.totalGifted.toLocaleString()}</p>
        <motion.div
          initial={{ height: 0 }}
          animate={{ height: 'auto' }}
          transition={{ delay: 0.2 }}
          className={`w-full ${getPodiumHeight(1)} bg-gradient-to-t ${getPodiumGradient(1)} rounded-t-xl mt-2 shadow-xl`}
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
          <div className="w-14 h-14 rounded-full bg-gradient-to-br from-amber-500 to-amber-700 flex items-center justify-center text-2xl border-4 border-amber-600 shadow-lg">
            {topThree[2]?.avatar}
          </div>
          <div className="absolute -bottom-1 -right-1 w-6 h-6 rounded-full bg-amber-600 flex items-center justify-center shadow-md">
            <span className="text-xs font-black text-amber-100">3</span>
          </div>
        </motion.div>
        <p className="text-sm font-bold text-foreground truncate max-w-[70px]">{topThree[2]?.name}</p>
        <p className="text-xs text-muted-foreground">₦{topThree[2]?.totalGifted.toLocaleString()}</p>
        <motion.div
          initial={{ height: 0 }}
          animate={{ height: 'auto' }}
          transition={{ delay: 0.4 }}
          className={`w-full ${getPodiumHeight(3)} bg-gradient-to-t ${getPodiumGradient(3)} rounded-t-xl mt-2 shadow-lg`}
        />
      </div>
    </motion.div>
  );
};
