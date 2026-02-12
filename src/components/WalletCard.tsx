import { motion } from "framer-motion";
import { Eye, EyeOff, Plus, ArrowUpRight, ArrowDownLeft, History, Coins } from "lucide-react";
import { useState } from "react";
import { Button } from "@/components/ui/button";
import { Currency } from "@/types/finance";

interface WalletCardProps {
  ngnBalance: number;
  usdtBalance: number;
  onAddFunds: () => void;
  onViewHistory: () => void;
  onSend: () => void;
  onWithdraw: () => void;
  activeCurrency: Currency;
  onCurrencyChange: (currency: Currency) => void;
}

export const WalletCard = ({
  ngnBalance,
  usdtBalance,
  onAddFunds,
  onViewHistory,
  onSend,
  onWithdraw,
  activeCurrency,
  onCurrencyChange,
}: WalletCardProps) => {
  const [showBalance, setShowBalance] = useState(true);

  const balance = activeCurrency === "NGN" ? ngnBalance : usdtBalance;
  const symbol = activeCurrency === "NGN" ? "₦" : "$";
  const hiddenText = activeCurrency === "NGN" ? "₦•••,•••" : "$•••.••";

  const formatBalance = (val: number) => {
    if (activeCurrency === "USDT") {
      return `$${val.toLocaleString(undefined, { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`;
    }
    return `₦${val.toLocaleString()}`;
  };

  return (
    <motion.div
      className="mx-6 mb-6 rounded-3xl overflow-hidden relative"
      initial={{ opacity: 0, scale: 0.95 }}
      animate={{ opacity: 1, scale: 1 }}
      transition={{ duration: 0.5, delay: 0.3 }}
    >
      {/* Gradient background */}
      <div
        className={`absolute inset-0 transition-colors duration-500 ${
          activeCurrency === "NGN"
            ? "bg-gradient-to-br from-primary via-yellow-500 to-accent opacity-90"
            : "bg-gradient-to-br from-emerald-600 via-teal-500 to-cyan-500 opacity-90"
        }`}
      />
      
      {/* Pattern overlay */}
      <div className="absolute inset-0 opacity-10">
        <div
          className="absolute inset-0"
          style={{
            backgroundImage: `url("data:image/svg+xml,%3Csvg width='60' height='60' viewBox='0 0 60 60' xmlns='http://www.w3.org/2000/svg'%3E%3Cg fill='none' fill-rule='evenodd'%3E%3Cg fill='%23000000' fill-opacity='0.4'%3E%3Cpath d='M36 34v-4h-2v4h-4v2h4v4h2v-4h4v-2h-4zm0-30V0h-2v4h-4v2h4v4h2V6h4V4h-4zM6 34v-4H4v4H0v2h4v4h2v-4h4v-2H6zM6 4V0H4v4H0v2h4v4h2V6h4V4H6z'/%3E%3C/g%3E%3C/g%3E%3C/svg%3E")`,
          }}
        />
      </div>

      <div className="relative z-10 p-6">
        {/* Currency Toggle */}
        <div className="flex items-center gap-2 mb-4">
          <button
            onClick={() => onCurrencyChange("NGN")}
            className={`px-3 py-1.5 rounded-full text-xs font-bold transition-all ${
              activeCurrency === "NGN"
                ? "bg-white/30 text-white"
                : "bg-white/10 text-white/60 hover:bg-white/15"
            }`}
          >
            🇳🇬 NGN
          </button>
          <button
            onClick={() => onCurrencyChange("USDT")}
            className={`px-3 py-1.5 rounded-full text-xs font-bold transition-all flex items-center gap-1 ${
              activeCurrency === "USDT"
                ? "bg-white/30 text-white"
                : "bg-white/10 text-white/60 hover:bg-white/15"
            }`}
          >
            <Coins className="w-3 h-3" /> USDT
          </button>
        </div>

        {/* Header */}
        <div className="flex items-center justify-between mb-6">
          <div>
            <p className="text-white/70 text-sm font-medium">
              {activeCurrency === "NGN" ? "Naira Balance" : "USDT Balance"}
            </p>
            <div className="flex items-center gap-2 mt-1">
              <motion.h2
                key={activeCurrency}
                initial={{ opacity: 0, y: 10 }}
                animate={{ opacity: 1, y: 0 }}
                className="text-3xl font-black text-white"
              >
                {showBalance ? formatBalance(balance ?? 0) : hiddenText}
              </motion.h2>
              <button
                onClick={() => setShowBalance(!showBalance)}
                className="p-1 hover:bg-white/20 rounded-lg transition-colors"
              >
                {showBalance ? (
                  <EyeOff className="w-5 h-5 text-white/70" />
                ) : (
                  <Eye className="w-5 h-5 text-white/70" />
                )}
              </button>
            </div>
            {/* Other currency hint */}
            {showBalance && (
              <p className="text-white/50 text-xs mt-1">
                {activeCurrency === "NGN"
                  ? `USDT: $${(usdtBalance ?? 0).toFixed(2)}`
                  : `NGN: ₦${(ngnBalance ?? 0).toLocaleString()}`}
              </p>
            )}
          </div>
          <motion.div
            className="text-5xl"
            animate={{ rotate: [0, 10, -10, 0] }}
            transition={{ duration: 2, repeat: Infinity, repeatDelay: 3 }}
          >
            {activeCurrency === "NGN" ? "💰" : "💎"}
          </motion.div>
        </div>

        {/* Action buttons */}
        <div className="grid grid-cols-4 gap-2">
          <Button
            variant="glass"
            size="sm"
            className="bg-white/20 border-white/30 text-white hover:bg-white/30 flex-col h-auto py-3"
            onClick={onAddFunds}
          >
            <Plus className="w-5 h-5 mb-1" />
            <span className="text-xs">Fund</span>
          </Button>
          <Button
            variant="glass"
            size="sm"
            className="bg-white/20 border-white/30 text-white hover:bg-white/30 flex-col h-auto py-3"
            onClick={onSend}
          >
            <ArrowUpRight className="w-5 h-5 mb-1" />
            <span className="text-xs">Send</span>
          </Button>
          <Button
            variant="glass"
            size="sm"
            className="bg-white/20 border-white/30 text-white hover:bg-white/30 flex-col h-auto py-3"
            onClick={onWithdraw}
          >
            <ArrowDownLeft className="w-5 h-5 mb-1" />
            <span className="text-xs">Withdraw</span>
          </Button>
          <Button
            variant="glass"
            size="sm"
            className="bg-white/20 border-white/30 text-white hover:bg-white/30 flex-col h-auto py-3"
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
