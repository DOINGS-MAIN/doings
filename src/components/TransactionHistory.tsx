import { motion } from "framer-motion";
import { ArrowUpRight, ArrowDownLeft, Gift, Wallet, Clock, CheckCircle2, XCircle } from "lucide-react";
import { Transaction } from "@/hooks/useWallet";
import { format } from "date-fns";

interface TransactionHistoryProps {
  transactions: Transaction[];
  isOpen: boolean;
  onClose: () => void;
}

const getTransactionIcon = (type: Transaction["type"]) => {
  switch (type) {
    case "deposit":
      return <ArrowDownLeft className="w-5 h-5 text-success" />;
    case "spray":
      return <ArrowUpRight className="w-5 h-5 text-accent" />;
    case "giveaway":
      return <Gift className="w-5 h-5 text-secondary" />;
    case "withdrawal":
      return <Wallet className="w-5 h-5 text-destructive" />;
    case "received":
      return <ArrowDownLeft className="w-5 h-5 text-primary" />;
    default:
      return <Wallet className="w-5 h-5 text-muted-foreground" />;
  }
};

const getTransactionColor = (type: Transaction["type"]) => {
  switch (type) {
    case "deposit":
    case "received":
      return "text-success";
    case "spray":
    case "withdrawal":
    case "giveaway":
      return "text-destructive";
    default:
      return "text-foreground";
  }
};

const getStatusIcon = (status: Transaction["status"]) => {
  switch (status) {
    case "completed":
      return <CheckCircle2 className="w-4 h-4 text-success" />;
    case "pending":
      return <Clock className="w-4 h-4 text-primary animate-pulse" />;
    case "failed":
      return <XCircle className="w-4 h-4 text-destructive" />;
  }
};

export const TransactionHistory = ({ transactions, isOpen, onClose }: TransactionHistoryProps) => {
  if (!isOpen) return null;

  const groupedTransactions = transactions.reduce((acc, transaction) => {
    const dateKey = format(new Date(transaction.timestamp), "yyyy-MM-dd");
    if (!acc[dateKey]) {
      acc[dateKey] = [];
    }
    acc[dateKey].push(transaction);
    return acc;
  }, {} as Record<string, Transaction[]>);

  const sortedDates = Object.keys(groupedTransactions).sort((a, b) => 
    new Date(b).getTime() - new Date(a).getTime()
  );

  return (
    <motion.div
      initial={{ opacity: 0 }}
      animate={{ opacity: 1 }}
      exit={{ opacity: 0 }}
      className="fixed inset-0 z-50 bg-background"
    >
      {/* Header */}
      <div className="sticky top-0 bg-background border-b border-border px-6 py-4 flex items-center justify-between">
        <h2 className="text-xl font-bold text-foreground">Transaction History</h2>
        <button
          onClick={onClose}
          className="text-muted-foreground hover:text-foreground transition-colors"
        >
          Close
        </button>
      </div>

      {/* Content */}
      <div className="p-6 pb-32 overflow-y-auto max-h-[calc(100vh-80px)]">
        {transactions.length === 0 ? (
          <motion.div
            initial={{ opacity: 0, y: 20 }}
            animate={{ opacity: 1, y: 0 }}
            className="text-center py-12"
          >
            <div className="w-20 h-20 mx-auto mb-4 rounded-full bg-muted flex items-center justify-center text-4xl">
              📭
            </div>
            <h3 className="font-bold text-foreground mb-2">No transactions yet</h3>
            <p className="text-muted-foreground text-sm">
              Your transaction history will appear here
            </p>
          </motion.div>
        ) : (
          <div className="space-y-6">
            {sortedDates.map((dateKey, dateIndex) => (
              <motion.div
                key={dateKey}
                initial={{ opacity: 0, y: 20 }}
                animate={{ opacity: 1, y: 0 }}
                transition={{ delay: dateIndex * 0.1 }}
              >
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
                        {getTransactionIcon(transaction.type)}
                      </div>
                      <div className="flex-1 min-w-0">
                        <div className="flex items-center gap-2">
                          <p className="font-semibold text-foreground truncate">
                            {transaction.description}
                          </p>
                          {getStatusIcon(transaction.status)}
                        </div>
                        <p className="text-sm text-muted-foreground">
                          {format(new Date(transaction.timestamp), "h:mm a")}
                          {transaction.reference && (
                            <span className="ml-2 text-xs opacity-60">
                              • {transaction.reference}
                            </span>
                          )}
                        </p>
                      </div>
                      <div className="text-right">
                        <p className={`font-bold ${getTransactionColor(transaction.type)}`}>
                          {transaction.amount > 0 ? "+" : ""}₦{Math.abs(transaction.amount).toLocaleString()}
                        </p>
                        <p className="text-xs text-muted-foreground capitalize">
                          {transaction.type}
                        </p>
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
