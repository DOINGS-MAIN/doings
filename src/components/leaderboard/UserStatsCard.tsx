import { motion } from "framer-motion";
import { Sparkles, Gift, Trophy } from "lucide-react";

interface UserStatsCardProps {
  rank: number;
  totalGifted: number;
  sprayAmount: number;
  giveawayAmount: number;
}

export const UserStatsCard = ({ rank, totalGifted, sprayAmount, giveawayAmount }: UserStatsCardProps) => {
  return (
    <motion.div
      initial={{ opacity: 0, y: 10 }}
      animate={{ opacity: 1, y: 0 }}
      className="glass rounded-2xl p-4 mb-4"
    >
      <div className="flex items-center justify-between mb-3">
        <div className="flex items-center gap-2">
          <Trophy className="w-5 h-5 text-primary" />
          <span className="font-bold text-foreground">Your Stats</span>
        </div>
        <div className="px-3 py-1 rounded-full bg-primary/20 text-primary text-sm font-bold">
          Rank #{rank}
        </div>
      </div>
      
      <div className="grid grid-cols-3 gap-3">
        <div className="text-center p-2 rounded-xl bg-muted/50">
          <p className="text-lg font-bold text-foreground">₦{totalGifted.toLocaleString()}</p>
          <p className="text-xs text-muted-foreground">Total Gifted</p>
        </div>
        <div className="text-center p-2 rounded-xl bg-muted/50">
          <div className="flex items-center justify-center gap-1">
            <Sparkles className="w-4 h-4 text-primary" />
            <p className="text-lg font-bold text-foreground">₦{sprayAmount.toLocaleString()}</p>
          </div>
          <p className="text-xs text-muted-foreground">Sprayed</p>
        </div>
        <div className="text-center p-2 rounded-xl bg-muted/50">
          <div className="flex items-center justify-center gap-1">
            <Gift className="w-4 h-4 text-accent" />
            <p className="text-lg font-bold text-foreground">₦{giveawayAmount.toLocaleString()}</p>
          </div>
          <p className="text-xs text-muted-foreground">Giveaways</p>
        </div>
      </div>
    </motion.div>
  );
};
