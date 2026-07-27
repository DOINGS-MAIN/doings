import { motion } from "framer-motion";
import {
  ArrowUpRight,
  ArrowDownLeft,
  ArrowLeftRight,
  Gift,
  Wallet,
  Clock,
  CheckCircle2,
  XCircle,
  Send,
  Copy,
  ExternalLink,
  Check,
} from "lucide-react";
import { FinanceTransaction } from "@/types/finance";
import { format } from "date-fns";
import { useMemo, useState } from "react";
import { toast } from "sonner";
import { getCryptoTrackId, shortenCryptoId, solanaExplorerTxUrl } from "@/lib/cryptoTx";
import {
  filterDisplayTransactions,
  fxSwapDisplayLeg,
  fxSwapSubtitle,
  fxSwapTitle,
  groupFxSwapTransactions,
  type DisplayTransaction,
} from "@/lib/fxTransactions";

interface TransactionHistoryProps {
  transactions: FinanceTransaction[];
  isOpen: boolean;
  onClose: () => void;
}

const getTransactionIcon = (type: FinanceTransaction["type"], _currency: string) => {
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
    case "swap":
      return <ArrowLeftRight className="w-5 h-5 text-primary" />;
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

const HIDDEN_USER_PROVIDER_TAGS = new Set(["flutterwave", "monnify", "nomba", "internal"]);

const showProviderTag = (provider?: string) =>
  Boolean(provider && !HIDDEN_USER_PROVIDER_TAGS.has(provider.toLowerCase()));

export const TransactionHistory = ({ transactions, isOpen, onClose }: TransactionHistoryProps) => {
  const [filter, setFilter] = useState<"all" | "NGN" | "USDC">("all");
  const [copiedId, setCopiedId] = useState<string | null>(null);

  const displayItems = useMemo(() => {
    const grouped = groupFxSwapTransactions(transactions);
    return filterDisplayTransactions(grouped, filter);
  }, [transactions, filter]);

  const groupedTransactions = useMemo(() => {
    return displayItems.reduce((acc, item) => {
      const createdAt =
        item.kind === "fx_swap"
          ? new Date(Math.max(item.ngn.createdAt.getTime(), item.usdc.createdAt.getTime()))
          : item.transaction.createdAt;
      const dateKey = format(createdAt, "yyyy-MM-dd");
      if (!acc[dateKey]) acc[dateKey] = [];
      acc[dateKey].push(item);
      return acc;
    }, {} as Record<string, DisplayTransaction[]>);
  }, [displayItems]);

  const sortedDates = useMemo(
    () =>
      Object.keys(groupedTransactions).sort(
        (a, b) => new Date(b).getTime() - new Date(a).getTime()
      ),
    [groupedTransactions]
  );

  if (!isOpen) return null;

  const formatAmount = (txn: FinanceTransaction) => {
    const symbol = txn.currency === "NGN" ? "₦" : "$";
    const absAmount = Math.abs(txn.amount);
    const formatted =
      txn.currency === "USDC"
        ? absAmount.toFixed(2)
        : absAmount.toLocaleString(undefined, { minimumFractionDigits: 2, maximumFractionDigits: 2 });
    return `${txn.amount > 0 ? "+" : ""}${symbol}${formatted}`;
  };

  const resolveRow = (item: DisplayTransaction) => {
    if (item.kind === "single") {
      return {
        key: item.transaction.id,
        transaction: item.transaction,
        title: item.transaction.description,
        subtitle: null as string | null,
        typeLabel: item.transaction.type,
      };
    }

    const leg = fxSwapDisplayLeg(item, filter);
    return {
      key: item.quoteId,
      transaction: leg,
      title: fxSwapTitle(item),
      subtitle: fxSwapSubtitle(item),
      typeLabel: "convert" as const,
    };
  };

  const copyTrackId = async (id: string) => {
    try {
      await navigator.clipboard.writeText(id);
      setCopiedId(id);
      toast.success("Transaction ID copied");
      window.setTimeout(() => setCopiedId((cur) => (cur === id ? null : cur)), 1500);
    } catch {
      toast.error("Could not copy");
    }
  };

  return (
    <motion.div
      initial={{ opacity: 0 }}
      animate={{ opacity: 1 }}
      exit={{ opacity: 0 }}
      className="fixed inset-0 z-50 flex flex-col overflow-hidden bg-background"
    >
      <div className="shrink-0 border-b border-border bg-background px-6 py-4">
        <div className="flex items-center justify-between mb-3">
          <h2 className="text-xl font-bold text-foreground">Transactions</h2>
          <button onClick={onClose} className="text-muted-foreground hover:text-foreground transition-colors">
            Close
          </button>
        </div>
        <div className="flex gap-2">
          {(["all", "NGN", "USDC"] as const).map((f) => (
            <button
              key={f}
              onClick={() => setFilter(f)}
              className={`px-3 py-1.5 rounded-full text-xs font-bold transition-all ${
                filter === f ? "bg-primary text-primary-foreground" : "bg-muted text-muted-foreground"
              }`}
            >
              {f === "all" ? "All" : f === "NGN" ? "🇳🇬 NGN" : "💎 USDC"}
            </button>
          ))}
        </div>
      </div>

      <div className="min-h-0 flex-1 overflow-y-auto overscroll-y-contain p-6 pb-32 [-webkit-overflow-scrolling:touch]">
        {displayItems.length === 0 ? (
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
                  {groupedTransactions[dateKey].map((item, index) => {
                    const row = resolveRow(item);
                    const { transaction } = row;
                    const trackId = getCryptoTrackId({
                      providerRef: transaction.providerRef,
                      metadata: transaction.metadata,
                      currency: transaction.currency,
                      provider: transaction.provider,
                    });

                    return (
                      <motion.div
                        key={row.key}
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
                            <p className="font-semibold text-foreground truncate">{row.title}</p>
                            {getStatusIcon(transaction.status)}
                          </div>
                          {row.subtitle && (
                            <p className="text-sm text-muted-foreground truncate">{row.subtitle}</p>
                          )}
                          <div className="flex items-center gap-2 text-sm text-muted-foreground">
                            <span>{format(new Date(transaction.createdAt), "h:mm a")}</span>
                            <span
                              className={`text-xs px-1.5 py-0.5 rounded ${
                                transaction.currency === "NGN"
                                  ? "bg-primary/10 text-primary"
                                  : "bg-emerald-500/10 text-emerald-500"
                              }`}
                            >
                              {transaction.currency}
                            </span>
                            {showProviderTag(transaction.provider) && (
                              <span className="text-xs opacity-60 capitalize">• {transaction.provider}</span>
                            )}
                          </div>
                          {trackId && (
                            <div className="mt-1.5 flex items-center gap-1.5">
                              <span className="font-mono text-[11px] text-muted-foreground truncate" title={trackId}>
                                {shortenCryptoId(trackId)}
                              </span>
                              <button
                                type="button"
                                className="rounded p-0.5 text-muted-foreground hover:text-foreground"
                                aria-label="Copy transaction ID"
                                onClick={() => void copyTrackId(trackId)}
                              >
                                {copiedId === trackId ? (
                                  <Check className="h-3 w-3 text-success" />
                                ) : (
                                  <Copy className="h-3 w-3" />
                                )}
                              </button>
                              <a
                                href={solanaExplorerTxUrl(trackId)}
                                target="_blank"
                                rel="noopener noreferrer"
                                className="rounded p-0.5 text-muted-foreground hover:text-foreground"
                                aria-label="View on Solscan"
                              >
                                <ExternalLink className="h-3 w-3" />
                              </a>
                            </div>
                          )}
                        </div>
                        <div className="text-right">
                          <p className={`font-bold ${getTransactionColor(transaction.amount)}`}>
                            {formatAmount(transaction)}
                          </p>
                          <p className="text-xs text-muted-foreground capitalize">{row.typeLabel}</p>
                        </div>
                      </motion.div>
                    );
                  })}
                </div>
              </motion.div>
            ))}
          </div>
        )}
      </div>
    </motion.div>
  );
};
