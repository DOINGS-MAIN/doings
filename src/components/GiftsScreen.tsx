import { useState } from "react";
import { motion, AnimatePresence } from "framer-motion";
import { Button } from "@/components/ui/button";
import { Gift, Plus, Users, Clock, CheckCircle, XCircle, Sparkles, ChevronRight } from "lucide-react";
import { Giveaway } from "@/hooks/useGiveaways";

interface GiftsScreenProps {
  myGiveaways: Giveaway[];
  onCreateGiveaway: () => void;
  onRedeemGiveaway: () => void;
  onViewGiveaway: (giveaway: Giveaway) => void;
}

export const GiftsScreen = ({
  myGiveaways,
  onCreateGiveaway,
  onRedeemGiveaway,
  onViewGiveaway,
}: GiftsScreenProps) => {
  const [filter, setFilter] = useState<'all' | 'active' | 'completed'>('all');

  const activeGiveaways = myGiveaways.filter(g => g.status === 'active');
  const completedGiveaways = myGiveaways.filter(g => g.status !== 'active');

  const filteredGiveaways = filter === 'all' 
    ? myGiveaways 
    : filter === 'active' 
      ? activeGiveaways 
      : completedGiveaways;

  const totalDistributed = myGiveaways.reduce((sum, g) => sum + (g.totalAmount - g.remainingAmount), 0);
  const totalRedemptions = myGiveaways.reduce((sum, g) => sum + g.redemptions.length, 0);

  const getStatusIcon = (status: Giveaway['status']) => {
    switch (status) {
      case 'active':
        return <span className="w-2 h-2 bg-green-500 rounded-full animate-pulse" />;
      case 'stopped':
        return <XCircle className="w-3 h-3 text-destructive" />;
      case 'exhausted':
        return <CheckCircle className="w-3 h-3 text-muted-foreground" />;
    }
  };

  const getStatusText = (status: Giveaway['status']) => {
    switch (status) {
      case 'active':
        return 'Active';
      case 'stopped':
        return 'Stopped';
      case 'exhausted':
        return 'Completed';
    }
  };

  return (
    <div className="px-6 pt-12 pb-6">
      {/* Header */}
      <motion.div
        initial={{ opacity: 0, y: -20 }}
        animate={{ opacity: 1, y: 0 }}
        className="mb-6"
      >
        <h1 className="text-2xl font-bold text-foreground mb-1">Gifts</h1>
        <p className="text-muted-foreground">Create and manage your giveaways</p>
      </motion.div>

      {/* Stats */}
      <motion.div
        initial={{ opacity: 0, y: 20 }}
        animate={{ opacity: 1, y: 0 }}
        transition={{ delay: 0.1 }}
        className="grid grid-cols-3 gap-3 mb-6"
      >
        <div className="glass rounded-2xl p-4 text-center">
          <Gift className="w-6 h-6 text-primary mx-auto mb-2" />
          <p className="text-lg font-bold text-foreground">{activeGiveaways.length}</p>
          <p className="text-xs text-muted-foreground">Active</p>
        </div>
        <div className="glass rounded-2xl p-4 text-center">
          <Users className="w-6 h-6 text-accent mx-auto mb-2" />
          <p className="text-lg font-bold text-foreground">{totalRedemptions}</p>
          <p className="text-xs text-muted-foreground">Redeemed</p>
        </div>
        <div className="glass rounded-2xl p-4 text-center">
          <Sparkles className="w-6 h-6 text-primary mx-auto mb-2" />
          <p className="text-lg font-bold text-foreground">₦{(totalDistributed / 1000).toFixed(0)}k</p>
          <p className="text-xs text-muted-foreground">Given</p>
        </div>
      </motion.div>

      {/* Quick Actions */}
      <motion.div
        initial={{ opacity: 0, y: 20 }}
        animate={{ opacity: 1, y: 0 }}
        transition={{ delay: 0.2 }}
        className="grid grid-cols-2 gap-3 mb-6"
      >
        <motion.button
          onClick={onCreateGiveaway}
          className="glass rounded-2xl p-4 flex flex-col items-center gap-2"
          whileHover={{ scale: 1.02 }}
          whileTap={{ scale: 0.98 }}
        >
          <div className="w-12 h-12 rounded-2xl bg-primary/20 flex items-center justify-center">
            <Plus className="w-6 h-6 text-primary" />
          </div>
          <div className="text-center">
            <h3 className="font-bold text-foreground text-sm">Create Giveaway</h3>
            <p className="text-xs text-muted-foreground">Share the love</p>
          </div>
        </motion.button>

        <motion.button
          onClick={onRedeemGiveaway}
          className="glass rounded-2xl p-4 flex flex-col items-center gap-2"
          whileHover={{ scale: 1.02 }}
          whileTap={{ scale: 0.98 }}
        >
          <div className="w-12 h-12 rounded-2xl bg-accent/20 flex items-center justify-center text-2xl">
            🎁
          </div>
          <div className="text-center">
            <h3 className="font-bold text-foreground text-sm">Redeem Code</h3>
            <p className="text-xs text-muted-foreground">Claim a gift</p>
          </div>
        </motion.button>
      </motion.div>

      {/* Filter Tabs */}
      <motion.div
        initial={{ opacity: 0, y: 20 }}
        animate={{ opacity: 1, y: 0 }}
        transition={{ delay: 0.3 }}
        className="flex gap-2 mb-4"
      >
        {(['all', 'active', 'completed'] as const).map((tab) => (
          <button
            key={tab}
            onClick={() => setFilter(tab)}
            className={`px-4 py-2 rounded-full text-sm font-medium transition-all ${
              filter === tab
                ? 'bg-primary text-primary-foreground'
                : 'bg-muted text-muted-foreground'
            }`}
          >
            {tab.charAt(0).toUpperCase() + tab.slice(1)}
          </button>
        ))}
      </motion.div>

      {/* Giveaways List */}
      <motion.div
        initial={{ opacity: 0 }}
        animate={{ opacity: 1 }}
        transition={{ delay: 0.4 }}
        className="space-y-3"
      >
        {filteredGiveaways.length === 0 ? (
          <div className="text-center py-12">
            <Gift className="w-16 h-16 text-muted-foreground mx-auto mb-4 opacity-50" />
            <p className="text-muted-foreground">No giveaways yet</p>
            <Button
              onClick={onCreateGiveaway}
              className="mt-4 rounded-xl"
            >
              Create Your First Giveaway
            </Button>
          </div>
        ) : (
          <AnimatePresence>
            {filteredGiveaways.map((giveaway, index) => (
              <motion.div
                key={giveaway.id}
                initial={{ opacity: 0, y: 20 }}
                animate={{ opacity: 1, y: 0 }}
                exit={{ opacity: 0, x: -100 }}
                transition={{ delay: index * 0.05 }}
                onClick={() => onViewGiveaway(giveaway)}
                className="glass rounded-2xl p-4 cursor-pointer hover:bg-muted/50 transition-colors"
              >
                <div className="flex items-center gap-3">
                  <div className="w-12 h-12 rounded-xl bg-gradient-to-br from-primary/20 to-accent/20 flex items-center justify-center">
                    <Gift className="w-6 h-6 text-primary" />
                  </div>
                  
                  <div className="flex-1 min-w-0">
                    <div className="flex items-center gap-2">
                      <h3 className="font-bold text-foreground text-sm truncate">{giveaway.title}</h3>
                      <span className={`inline-flex items-center gap-1 px-2 py-0.5 rounded-full text-xs font-medium ${
                        giveaway.status === 'active' 
                          ? 'bg-green-500/20 text-green-400'
                          : giveaway.status === 'stopped'
                            ? 'bg-red-500/20 text-red-400'
                            : 'bg-muted text-muted-foreground'
                      }`}>
                        {getStatusIcon(giveaway.status)}
                        {getStatusText(giveaway.status)}
                      </span>
                    </div>
                    <div className="flex items-center gap-3 mt-1">
                      <span className="text-xs text-muted-foreground">
                        ₦{giveaway.perPersonAmount.toLocaleString()}/person
                      </span>
                      <span className="text-xs text-muted-foreground">
                        • {giveaway.redemptions.length} redeemed
                      </span>
                    </div>
                  </div>

                  <div className="text-right">
                    <p className="text-sm font-bold text-primary">
                      ₦{giveaway.remainingAmount.toLocaleString()}
                    </p>
                    <p className="text-xs text-muted-foreground">remaining</p>
                  </div>

                  <ChevronRight className="w-5 h-5 text-muted-foreground" />
                </div>

                {/* Progress bar */}
                <div className="mt-3">
                  <div className="h-1.5 bg-muted rounded-full overflow-hidden">
                    <motion.div
                      initial={{ width: 0 }}
                      animate={{ 
                        width: `${((giveaway.totalAmount - giveaway.remainingAmount) / giveaway.totalAmount) * 100}%` 
                      }}
                      className="h-full bg-gradient-to-r from-primary to-accent rounded-full"
                    />
                  </div>
                </div>
              </motion.div>
            ))}
          </AnimatePresence>
        )}
      </motion.div>
    </div>
  );
};
