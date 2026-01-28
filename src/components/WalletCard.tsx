import { motion } from "framer-motion";
import { Eye, EyeOff, Plus, ArrowUpRight, ArrowDownLeft, History } from "lucide-react";
import { useState } from "react";
import { Button } from "@/components/ui/button";

interface WalletCardProps {
  balance: number;
  onAddFunds: () => void;
  onViewHistory: () => void;
  onSend: () => void;
  onWithdraw: () => void;
}

export const WalletCard = ({ balance, onAddFunds, onViewHistory, onSend, onWithdraw }: WalletCardProps) => {
  const [showBalance, setShowBalance] = useState(true);

  return (
    <motion.div
      className="mx-6 mb-6 rounded-3xl overflow-hidden relative"
      initial={{ opacity: 0, scale: 0.95 }}
      animate={{ opacity: 1, scale: 1 }}
      transition={{ duration: 0.5, delay: 0.3 }}
    >
      {/* Gradient background */}
      <div className="absolute inset-0 bg-gradient-to-br from-primary via-yellow-500 to-accent opacity-90" />
      
      {/* Pattern overlay */}
      <div className="absolute inset-0 opacity-10">
        <div className="absolute inset-0" style={{
          backgroundImage: `url("data:image/svg+xml,%3Csvg width='60' height='60' viewBox='0 0 60 60' xmlns='http://www.w3.org/2000/svg'%3E%3Cg fill='none' fill-rule='evenodd'%3E%3Cg fill='%23000000' fill-opacity='0.4'%3E%3Cpath d='M36 34v-4h-2v4h-4v2h4v4h2v-4h4v-2h-4zm0-30V0h-2v4h-4v2h4v4h2V6h4V4h-4zM6 34v-4H4v4H0v2h4v4h2v-4h4v-2H6zM6 4V0H4v4H0v2h4v4h2V6h4V4H6z'/%3E%3C/g%3E%3C/g%3E%3C/svg%3E")`,
        }} />
      </div>

      <div className="relative z-10 p-6">
        {/* Header */}
        <div className="flex items-center justify-between mb-6">
          <div>
            <p className="text-primary-foreground/70 text-sm font-medium">Your Balance</p>
            <div className="flex items-center gap-2 mt-1">
              <h2 className="text-3xl font-black text-primary-foreground">
                {showBalance ? `₦${(balance ?? 0).toLocaleString()}` : "₦•••,•••"}
              </h2>
              <button
                onClick={() => setShowBalance(!showBalance)}
                className="p-1 hover:bg-white/20 rounded-lg transition-colors"
              >
                {showBalance ? (
                  <EyeOff className="w-5 h-5 text-primary-foreground/70" />
                ) : (
                  <Eye className="w-5 h-5 text-primary-foreground/70" />
                )}
              </button>
            </div>
          </div>
          <motion.div
            className="text-5xl"
            animate={{ rotate: [0, 10, -10, 0] }}
            transition={{ duration: 2, repeat: Infinity, repeatDelay: 3 }}
          >
            💰
          </motion.div>
        </div>

        {/* Action buttons */}
        <div className="grid grid-cols-4 gap-2">
          <Button
            variant="glass"
            size="sm"
            className="bg-white/20 border-white/30 text-primary-foreground hover:bg-white/30 flex-col h-auto py-3"
            onClick={onAddFunds}
          >
            <Plus className="w-5 h-5 mb-1" />
            <span className="text-xs">Add</span>
          </Button>
          <Button
            variant="glass"
            size="sm"
            className="bg-white/20 border-white/30 text-primary-foreground hover:bg-white/30 flex-col h-auto py-3"
            onClick={onSend}
          >
            <ArrowUpRight className="w-5 h-5 mb-1" />
            <span className="text-xs">Send</span>
          </Button>
          <Button
            variant="glass"
            size="sm"
            className="bg-white/20 border-white/30 text-primary-foreground hover:bg-white/30 flex-col h-auto py-3"
            onClick={onWithdraw}
          >
            <ArrowDownLeft className="w-5 h-5 mb-1" />
            <span className="text-xs">Withdraw</span>
          </Button>
          <Button
            variant="glass"
            size="sm"
            className="bg-white/20 border-white/30 text-primary-foreground hover:bg-white/30 flex-col h-auto py-3"
            onClick={onViewHistory}
          >
            <History className="w-5 h-5 mb-1" />
            <span className="text-xs">History</span>
          </Button>
        </div>
      </div>
    </motion.div>
  );
};
