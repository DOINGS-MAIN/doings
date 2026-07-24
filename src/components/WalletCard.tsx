import { motion } from "framer-motion";
import { Eye, EyeOff, Plus, ArrowUpRight, ArrowDownLeft, History, Coins, RefreshCw, ArrowLeftRight } from "lucide-react";
import { useState } from "react";
import { Button } from "@/components/ui/button";
import { Currency } from "@/types/finance";

interface WalletCardProps {
  ngnBalance: number;
  usdcBalance: number;
  onAddFunds: () => void;
  onViewHistory: () => void;
  onSend: () => void;
  onWithdraw: () => void;
  onConvert?: () => void;
  activeCurrency: Currency;
  onCurrencyChange: (currency: Currency) => void;
  onRefreshBalance?: () => void;
  balanceRefreshing?: boolean;
  loading?: boolean;
}

export const WalletCard = ({
  ngnBalance,
  usdcBalance,
  onAddFunds,
  onViewHistory,
  onSend,
  onWithdraw,
  onConvert,
  activeCurrency,
  onCurrencyChange,
  onRefreshBalance,
  balanceRefreshing = false,
  loading = false,
}: WalletCardProps) => {
  const [showBalance, setShowBalance] = useState(true);

  const balance = activeCurrency === "NGN" ? ngnBalance : usdcBalance;
  const symbol = activeCurrency === "NGN" ? "₦" : "$";
  const hiddenText = activeCurrency === "NGN" ? "₦•••,•••" : "$•••.••";

  const formatBalance = (val: number) => {
    if (activeCurrency === "USDC") {
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
            onClick={() => onCurrencyChange("USDC")}
            className={`px-3 py-1.5 rounded-full text-xs font-bold transition-all flex items-center gap-1 ${
              activeCurrency === "USDC"
                ? "bg-white/30 text-white"
                : "bg-white/10 text-white/60 hover:bg-white/15"
            }`}
          >
            <Coins className="w-3 h-3" /> USDC
          </button>
        </div>

        {/* Header */}
        <div className="flex items-center justify-between mb-6">
          <div>
            <p className="text-white/70 text-sm font-medium">
              {activeCurrency === "NGN" ? "Naira Balance" : "USDC Balance"}
            </p>
            <div className="flex items-center gap-2 mt-1">
              {loading ? (
                <div
                  className="h-9 w-40 rounded-lg bg-white/25 animate-pulse"
                  aria-label="Loading balance"
                />
              ) : (
                <motion.h2
                  key={activeCurrency}
                  initial={{ opacity: 0, y: 10 }}
                  animate={{ opacity: 1, y: 0 }}
                  className="text-3xl font-black text-white"
                >
                  {showBalance ? formatBalance(balance ?? 0) : hiddenText}
                </motion.h2>
              )}
              <button
                onClick={() => setShowBalance(!showBalance)}
                disabled={loading}
                className="p-1 hover:bg-white/20 rounded-lg transition-colors disabled:opacity-40"
                aria-label={showBalance ? "Hide balance" : "Show balance"}
              >
                {showBalance ? (
                  <EyeOff className="w-5 h-5 text-white/70" />
                ) : (
                  <Eye className="w-5 h-5 text-white/70" />
                )}
              </button>
              {onRefreshBalance && (
                <button
                  type="button"
                  onClick={onRefreshBalance}
                  disabled={balanceRefreshing || loading}
                  className="p-1 hover:bg-white/20 rounded-lg transition-colors disabled:opacity-50"
                  aria-label="Refresh balance"
                  title="Refresh balance"
                >
                  <RefreshCw className={`w-5 h-5 text-white/70 ${balanceRefreshing || loading ? "animate-spin" : ""}`} />
                </button>
              )}
            </div>
            {/* Other currency hint */}
            {loading ? (
              <div className="h-3 w-24 rounded bg-white/15 animate-pulse mt-2" aria-hidden />
            ) : (
              showBalance && (
                <p className="text-white/50 text-xs mt-1">
                  {activeCurrency === "NGN"
                    ? `USDC: $${(usdcBalance ?? 0).toFixed(2)}`
                    : `NGN: ₦${(ngnBalance ?? 0).toLocaleString()}`}
                </p>
              )
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
        <div className="grid grid-cols-5 gap-1.5">
          <Button
            variant="glass"
            size="sm"
            className="bg-white/20 border-white/30 text-white hover:bg-white/30 flex-col h-auto py-2.5 px-1"
            onClick={onAddFunds}
          >
            <Plus className="w-4 h-4 mb-0.5" />
            <span className="text-[10px]">Fund</span>
          </Button>
          <Button
            variant="glass"
            size="sm"
            className="bg-white/20 border-white/30 text-white hover:bg-white/30 flex-col h-auto py-2.5 px-1"
            onClick={onSend}
          >
            <ArrowUpRight className="w-4 h-4 mb-0.5" />
            <span className="text-[10px]">Send</span>
          </Button>
          {onConvert && (
            <Button
              variant="glass"
              size="sm"
              className="bg-white/20 border-white/30 text-white hover:bg-white/30 flex-col h-auto py-2.5 px-1"
              onClick={onConvert}
            >
              <ArrowLeftRight className="w-4 h-4 mb-0.5" />
              <span className="text-[10px]">Convert</span>
            </Button>
          )}
          <Button
            variant="glass"
            size="sm"
            className="bg-white/20 border-white/30 text-white hover:bg-white/30 flex-col h-auto py-2.5 px-1"
            onClick={onWithdraw}
          >
            <ArrowDownLeft className="w-4 h-4 mb-0.5" />
            <span className="text-[10px]">Withdraw</span>
          </Button>
          <Button
            variant="glass"
            size="sm"
            className="bg-white/20 border-white/30 text-white hover:bg-white/30 flex-col h-auto py-2.5 px-1"
            onClick={onViewHistory}
          >
            <History className="w-4 h-4 mb-0.5" />
            <span className="text-[10px]">History</span>
          </Button>
        </div>
      </div>
    </motion.div>
  );
};
