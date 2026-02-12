import { motion } from "framer-motion";
import { ArrowUpRight, ArrowDownLeft, Gift, Wallet, Clock, CheckCircle2, XCircle, Send, Coins } from "lucide-react";
import { FinanceTransaction } from "@/types/finance";
import { format } from "date-fns";
import { useState } from "react";

interface TransactionHistoryProps {
  transactions: FinanceTransaction[];
  isOpen: boolean;
  onClose: () => void;
}

const getTransactionIcon = (type: FinanceTransaction["type"], currency: string) => {
  switch (type) {
    case "deposit":
      return <ArrowDownLeft className="w-5 h-5 text-success" />;
    case "spray":
      return <ArrowUpRight className="w-5 h-5 text-accent" />;
    case "giveaway":
      return <Gift className="w-5 h-5 text-secondary" />;
    case "withdrawal":
      return <Wallet className="w-5 h-5 text-destructive" />;
    case "receive":
      return <ArrowDownLeft className="w-5 h-5 text-primary" />;
    case "send":
      return <Send className="w-5 h-5 text-accent" />;
    default:
      return <Wallet className="w-5 h-5 text-muted-foreground" />;
  }
};

const getTransactionColor = (amount: number) => {
  return amount > 0 ? "text-success" : "text-destructive";
};

const getStatusIcon = (status: FinanceTransaction["status"]) => {
  switch (status) {
    case "completed":
      return <CheckCircle2 className="w-4 h-4 text-success" />;
    case "pending":
    case "processing":
      return <Clock className="w-4 h-4 text-primary animate-pulse" />;
    case "failed":
      return <XCircle className="w-4 h-4 text-destructive" />;
  }
};

export const TransactionHistory = ({ transactions, isOpen, onClose }: TransactionHistoryProps) => {
  const [filter, setFilter] = useState<"all" | "NGN" | "USDT">("all");

  if (!isOpen) return null;

  const filtered = filter === "all" ? transactions : transactions.filter((t) => t.currency === filter);

  const groupedTransactions = filtered.reduce((acc, transaction) => {
    const dateKey = format(new Date(transaction.createdAt), "yyyy-MM-dd");
    if (!acc[dateKey]) acc[dateKey] = [];
    acc[dateKey].push(transaction);
    return acc;
  }, {} as Record<string, FinanceTransaction[]>);

  const sortedDates = Object.keys(groupedTransactions).sort(
    (a, b) => new Date(b).getTime() - new Date(a).getTime()
  );

  const formatAmount = (txn: FinanceTransaction) => {
    const symbol = txn.currency === "NGN" ? "₦" : "$";
    const absAmount = Math.abs(txn.amount);
    const formatted = txn.currency === "USDT" ? absAmount.toFixed(2) : absAmount.toLocaleString();
    return `${txn.amount > 0 ? "+" : ""}${symbol}${formatted}`;
  };

  return (
    <motion.div
      initial={{ opacity: 0 }}
      animate={{ opacity: 1 }}
      exit={{ opacity: 0 }}
      className="fixed inset-0 z-50 bg-background"
    >
      <div className="sticky top-0 bg-background border-b border-border px-6 py-4">
        <div className="flex items-center justify-between mb-3">
          <h2 className="text-xl font-bold text-foreground">Transactions</h2>
          <button onClick={onClose} className="text-muted-foreground hover:text-foreground transition-colors">
            Close
          </button>
        </div>
        {/* Currency Filter */}
        <div className="flex gap-2">
          {(["all", "NGN", "USDT"] as const).map((f) => (
            <button
              key={f}
              onClick={() => setFilter(f)}
              className={`px-3 py-1.5 rounded-full text-xs font-bold transition-all ${
                filter === f ? "bg-primary text-primary-foreground" : "bg-muted text-muted-foreground"
              }`}
            >
              {f === "all" ? "All" : f === "NGN" ? "🇳🇬 NGN" : "💎 USDT"}
            </button>
          ))}
        </div>
      </div>

      <div className="p-6 pb-32 overflow-y-auto max-h-[calc(100vh-120px)]">
        {filtered.length === 0 ? (
          <motion.div initial={{ opacity: 0, y: 20 }} animate={{ opacity: 1, y: 0 }} className="text-center py-12">
            <div className="w-20 h-20 mx-auto mb-4 rounded-full bg-muted flex items-center justify-center text-4xl">📭</div>
            <h3 className="font-bold text-foreground mb-2">No transactions yet</h3>
            <p className="text-muted-foreground text-sm">Your transaction history will appear here</p>
          </motion.div>
        ) : (
          <div className="space-y-6">
            {sortedDates.map((dateKey, dateIndex) => (
              <motion.div key={dateKey} initial={{ opacity: 0, y: 20 }} animate={{ opacity: 1, y: 0 }} transition={{ delay: dateIndex * 0.1 }}>
                <h3 className="text-sm font-semibold text-muted-foreground mb-3">
                  {format(new Date(dateKey), "MMMM d, yyyy")}
                </h3>
                <div className="space-y-3">
                  {groupedTransactions[dateKey].map((transaction, index) => (
                    <motion.div
                      key={transaction.id}
                      initial={{ opacity: 0, x: -20 }}
                      animate={{ opacity: 1, x: 0 }}
                      transition={{ delay: dateIndex * 0.1 + index * 0.05 }}
                      className="glass rounded-2xl p-4 flex items-center gap-4"
                    >
                      <div className="w-12 h-12 rounded-xl bg-muted flex items-center justify-center">
                        {getTransactionIcon(transaction.type, transaction.currency)}
                      </div>
                      <div className="flex-1 min-w-0">
                        <div className="flex items-center gap-2">
                          <p className="font-semibold text-foreground truncate">{transaction.description}</p>
                          {getStatusIcon(transaction.status)}
                        </div>
                        <div className="flex items-center gap-2 text-sm text-muted-foreground">
                          <span>{format(new Date(transaction.createdAt), "h:mm a")}</span>
                          <span className={`text-xs px-1.5 py-0.5 rounded ${
                            transaction.currency === "NGN" ? "bg-primary/10 text-primary" : "bg-emerald-500/10 text-emerald-500"
                          }`}>
                            {transaction.currency}
                          </span>
                          {transaction.provider && (
                            <span className="text-xs opacity-60 capitalize">• {transaction.provider}</span>
                          )}
                        </div>
                      </div>
                      <div className="text-right">
                        <p className={`font-bold ${getTransactionColor(transaction.amount)}`}>
                          {formatAmount(transaction)}
                        </p>
                        <p className="text-xs text-muted-foreground capitalize">{transaction.type}</p>
                      </div>
                    </motion.div>
                  ))}
                </div>
              </motion.div>
            ))}
          </div>
        )}
      </div>
    </motion.div>
  );
};
