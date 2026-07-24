import { useState, useEffect } from "react";
import { useNavigate } from "react-router-dom";
import { 
  Search, 
  Eye,
  Filter, 
  MoreHorizontal,
  RefreshCw,
  Flag,
  FlagOff,
  Download,
  AlertTriangle,
  ExternalLink,
} from "lucide-react";
import { getCryptoTrackId, shortenCryptoId, solanaExplorerTxUrl } from "@/lib/cryptoTx";
import { Input } from "@/components/ui/input";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from "@/components/ui/table";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuSeparator,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { Textarea } from "@/components/ui/textarea";
import { Card, CardContent } from "@/components/ui/card";
import { useAdminData } from "@/hooks/useAdminData";
import { useAdminAuth } from "@/hooks/useAdminAuth";
import { canWritePayments } from "@/lib/adminPermissions";
import { admin as adminApi } from "@/lib/supabase";
import { AdminTransaction } from "@/types/admin";
import { format, formatDistanceToNow } from "date-fns";
import { toast } from "sonner";

export const AdminTransactions = () => {
  const navigate = useNavigate();
  const { currentAccount } = useAdminAuth();
  const canWrite = currentAccount ? canWritePayments(currentAccount.role) : false;
  const {
    transactions,
    getStats,
    refundTransaction,
    flagTransaction,
    unflagTransaction,
    fetchTransactions,
    transactionsLoading,
    transactionTotal,
    transactionPage,
  } = useAdminData();
  const stats = getStats();
  const [searchQuery, setSearchQuery] = useState("");
  const [debouncedSearch, setDebouncedSearch] = useState("");
  const [typeFilter, setTypeFilter] = useState<string>("all");
  const [statusFilter, setStatusFilter] = useState<string>("all");
  const [flagFilter, setFlagFilter] = useState<string>("all");
  const [providerFilter, setProviderFilter] = useState<string>("all");
  const [page, setPage] = useState(1);
  const [selectedTxn, setSelectedTxn] = useState<AdminTransaction | null>(null);
  const [actionType, setActionType] = useState<"flag" | "refund" | null>(null);
  const [flagReason, setFlagReason] = useState("");

  useEffect(() => {
    const timer = setTimeout(() => setDebouncedSearch(searchQuery), 300);
    return () => clearTimeout(timer);
  }, [searchQuery]);

  useEffect(() => {
    setPage(1);
  }, [debouncedSearch, typeFilter, statusFilter, flagFilter, providerFilter]);

  useEffect(() => {
    fetchTransactions({
      page,
      limit: 50,
      search: debouncedSearch,
      type: typeFilter,
      status: statusFilter,
      flagged: flagFilter,
      provider: providerFilter,
    });
  }, [page, debouncedSearch, typeFilter, statusFilter, flagFilter, providerFilter, fetchTransactions]);

  const formatCurrency = (amount: number, currency: AdminTransaction["currency"] = "NGN") => {
    if (currency === "USDC") {
      return new Intl.NumberFormat("en-US", {
        style: "currency",
        currency: "USD",
        minimumFractionDigits: 2,
      }).format(Math.abs(amount));
    }
    return new Intl.NumberFormat("en-NG", {
      style: "currency",
      currency: "NGN",
      minimumFractionDigits: 0,
    }).format(Math.abs(amount));
  };

  const totalPages = Math.max(1, Math.ceil(transactionTotal / 50));

  const getStatusBadge = (status: AdminTransaction["status"]) => {
    switch (status) {
      case "completed":
        return <Badge className="bg-success/20 text-success border-0">Completed</Badge>;
      case "pending":
        return <Badge className="bg-primary/20 text-primary border-0">Pending</Badge>;
      case "processing":
        return <Badge className="bg-accent/20 text-accent border-0">Processing</Badge>;
      case "failed":
        return <Badge variant="destructive">Failed</Badge>;
      case "refunded":
        return <Badge className="bg-secondary/20 text-secondary border-0">Refunded</Badge>;
    }
  };

  const getTypeBadge = (type: AdminTransaction["type"]) => {
    const colors: Record<string, string> = {
      deposit: "bg-success/20 text-success",
      withdrawal: "bg-accent/20 text-accent",
      spray: "bg-primary/20 text-primary",
      giveaway: "bg-secondary/20 text-secondary",
      refund: "bg-muted text-muted-foreground",
    };
    return (
      <Badge className={`${colors[type]} border-0 capitalize`}>
        {type}
      </Badge>
    );
  };

  const handleFlag = async () => {
    if (!selectedTxn) return;
    try {
      await flagTransaction(selectedTxn.id, flagReason);
      toast.success("Transaction flagged for review");
    } catch (err) {
      toast.error(err instanceof Error ? err.message : "Failed to flag transaction");
      return;
    }
    setSelectedTxn(null);
    setActionType(null);
    setFlagReason("");
  };

  const handleUnflag = async (txn: AdminTransaction) => {
    try {
      await unflagTransaction(txn.id);
      toast.success("Transaction unflagged");
    } catch (err) {
      toast.error(err instanceof Error ? err.message : "Failed to unflag");
    }
  };

  const handleRefund = async () => {
    if (!selectedTxn) return;
    try {
      await refundTransaction(selectedTxn.id, "Admin refund");
      toast.success("Transaction refunded successfully");
    } catch (err) {
      toast.error(err instanceof Error ? err.message : "Refund failed");
      return;
    }
    setSelectedTxn(null);
    setActionType(null);
  };

  return (
    <div className="p-8 space-y-6">
      {/* Header */}
      <div>
        <h1 className="text-3xl font-bold text-foreground">Transaction Monitoring</h1>
        <p className="text-muted-foreground mt-1">Track and manage all platform transactions</p>
      </div>

      {/* Stats Cards */}
      <div className="grid grid-cols-1 md:grid-cols-4 gap-4">
        <Card className="bg-card border-border">
          <CardContent className="p-4">
            <p className="text-sm text-muted-foreground">Total Volume</p>
            <p className="text-2xl font-bold">{formatCurrency(stats.totalVolume)}</p>
          </CardContent>
        </Card>
        <Card className="bg-card border-border">
          <CardContent className="p-4">
            <p className="text-sm text-muted-foreground">Today's Volume</p>
            <p className="text-2xl font-bold">{formatCurrency(stats.todayVolume)}</p>
          </CardContent>
        </Card>
        <Card className="bg-card border-border">
          <CardContent className="p-4">
            <p className="text-sm text-muted-foreground">Total Transactions</p>
            <p className="text-2xl font-bold">{stats.totalTransactions}</p>
          </CardContent>
        </Card>
        <Card className="bg-card border-border">
          <CardContent className="p-4 flex items-center justify-between">
            <div>
              <p className="text-sm text-muted-foreground">Flagged</p>
              <p className="text-2xl font-bold text-destructive">{stats.flaggedTransactions}</p>
            </div>
            {stats.flaggedTransactions > 0 && (
              <AlertTriangle className="w-8 h-8 text-destructive" />
            )}
          </CardContent>
        </Card>
      </div>

      {/* Filters */}
      <div className="flex flex-col sm:flex-row gap-4">
        <div className="relative flex-1">
          <Search className="absolute left-3 top-1/2 -translate-y-1/2 w-4 h-4 text-muted-foreground" />
          <Input
            placeholder="Search by user or reference..."
            value={searchQuery}
            onChange={(e) => setSearchQuery(e.target.value)}
            className="pl-10"
          />
        </div>
        <Select value={typeFilter} onValueChange={setTypeFilter}>
          <SelectTrigger className="w-[140px]">
            <SelectValue placeholder="Type" />
          </SelectTrigger>
          <SelectContent>
            <SelectItem value="all">All Types</SelectItem>
            <SelectItem value="deposit">Deposit</SelectItem>
            <SelectItem value="withdrawal">Withdrawal</SelectItem>
            <SelectItem value="spray">Spray</SelectItem>
            <SelectItem value="giveaway">Giveaway</SelectItem>
            <SelectItem value="refund">Refund</SelectItem>
          </SelectContent>
        </Select>
        <Select value={statusFilter} onValueChange={setStatusFilter}>
          <SelectTrigger className="w-[140px]">
            <SelectValue placeholder="Status" />
          </SelectTrigger>
          <SelectContent>
            <SelectItem value="all">All Status</SelectItem>
            <SelectItem value="completed">Completed</SelectItem>
            <SelectItem value="pending">Pending</SelectItem>
            <SelectItem value="processing">Processing</SelectItem>
            <SelectItem value="failed">Failed</SelectItem>
            <SelectItem value="refunded">Refunded</SelectItem>
          </SelectContent>
        </Select>
        <Select value={providerFilter} onValueChange={setProviderFilter}>
          <SelectTrigger className="w-[140px]">
            <SelectValue placeholder="Provider" />
          </SelectTrigger>
          <SelectContent>
            <SelectItem value="all">All Providers</SelectItem>
            <SelectItem value="monnify">Monnify</SelectItem>
            <SelectItem value="nomba">Nomba</SelectItem>
            <SelectItem value="flutterwave">Flutterwave</SelectItem>
            <SelectItem value="blockradar">Blockradar</SelectItem>
            <SelectItem value="internal">Internal</SelectItem>
          </SelectContent>
        </Select>
        <Select value={flagFilter} onValueChange={setFlagFilter}>
          <SelectTrigger className="w-[140px]">
            <SelectValue placeholder="Flags" />
          </SelectTrigger>
          <SelectContent>
            <SelectItem value="all">All</SelectItem>
            <SelectItem value="flagged">Flagged</SelectItem>
            <SelectItem value="unflagged">Unflagged</SelectItem>
          </SelectContent>
        </Select>
        <Button
          variant="outline"
          className="gap-2"
          onClick={() =>
            adminApi.transactions.exportCsv({
              ...(statusFilter !== "all" ? { status: statusFilter } : {}),
              ...(typeFilter !== "all" ? { type: typeFilter } : {}),
              ...(providerFilter !== "all" ? { provider: providerFilter } : {}),
              ...(flagFilter !== "all" ? { flagged: flagFilter === "flagged" ? "true" : "false" } : {}),
              ...(debouncedSearch ? { search: debouncedSearch } : {}),
            })
          }
        >
          <Download className="w-4 h-4" />
          Export
        </Button>
      </div>

      {/* Transactions Table */}
      <div className="bg-card rounded-xl border border-border overflow-hidden">
        <Table>
          <TableHeader>
            <TableRow className="border-border hover:bg-transparent">
              <TableHead className="text-muted-foreground">Reference</TableHead>
              <TableHead className="text-muted-foreground">User</TableHead>
              <TableHead className="text-muted-foreground">Type</TableHead>
              <TableHead className="text-muted-foreground">Amount</TableHead>
              <TableHead className="text-muted-foreground">Fee</TableHead>
              <TableHead className="text-muted-foreground">Provider</TableHead>
              <TableHead className="text-muted-foreground">Status</TableHead>
              <TableHead className="text-muted-foreground">Date</TableHead>
              <TableHead className="text-muted-foreground w-[50px]"></TableHead>
            </TableRow>
          </TableHeader>
          <TableBody>
            {transactionsLoading ? (
              <TableRow>
                <TableCell colSpan={9} className="text-center py-8 text-muted-foreground">
                  Loading transactions...
                </TableCell>
              </TableRow>
            ) : transactions.length === 0 ? (
              <TableRow>
                <TableCell colSpan={9} className="text-center py-8 text-muted-foreground">
                  No transactions found
                </TableCell>
              </TableRow>
            ) : (
            transactions.map((txn) => (
              <TableRow 
                key={txn.id} 
                className={`border-border cursor-pointer hover:bg-muted/30 ${txn.flagged ? "bg-destructive/5" : ""}`}
                onClick={() => navigate(`/admin/transactions/${txn.id}`)}
              >
                <TableCell>
                  <div className="flex items-center gap-2">
                    {txn.flagged && <Flag className="w-4 h-4 text-destructive" />}
                    <div className="min-w-0">
                      {(() => {
                        const trackId = getCryptoTrackId({
                          providerRef: txn.providerRef,
                          metadata: txn.metadata,
                          currency: txn.currency,
                          provider: txn.provider,
                        });
                        if (trackId) {
                          return (
                            <>
                              <div className="flex items-center gap-1.5">
                                <span className="font-mono text-sm" title={trackId}>
                                  {shortenCryptoId(trackId, 10, 8)}
                                </span>
                                <a
                                  href={solanaExplorerTxUrl(trackId)}
                                  target="_blank"
                                  rel="noopener noreferrer"
                                  className="text-muted-foreground hover:text-foreground"
                                  onClick={(e) => e.stopPropagation()}
                                  aria-label="Open on Solscan"
                                >
                                  <ExternalLink className="h-3.5 w-3.5" />
                                </a>
                              </div>
                              <p className="text-[11px] text-muted-foreground font-mono truncate max-w-[180px]" title={txn.reference}>
                                {txn.reference}
                              </p>
                            </>
                          );
                        }
                        return <span className="font-mono text-sm">{txn.reference}</span>;
                      })()}
                    </div>
                  </div>
                </TableCell>
                <TableCell>
                  <p className="font-medium text-foreground">{txn.userName}</p>
                </TableCell>
                <TableCell>{getTypeBadge(txn.type)}</TableCell>
                <TableCell>
                  <span className={`font-semibold ${txn.amount >= 0 ? "text-success" : "text-foreground"}`}>
                    {txn.amount >= 0 ? "+" : "-"}{formatCurrency(txn.amount, txn.currency)}
                  </span>
                </TableCell>
                <TableCell>
                  {(txn.fee ?? 0) > 0 ? (
                    <span className="text-sm font-medium text-primary">
                      {formatCurrency(txn.fee ?? 0, txn.currency)}
                    </span>
                  ) : (
                    <span className="text-sm text-muted-foreground">—</span>
                  )}
                </TableCell>
                <TableCell className="text-sm capitalize">{txn.provider ?? "—"}</TableCell>
                <TableCell>{getStatusBadge(txn.status)}</TableCell>
                <TableCell className="text-sm text-muted-foreground">
                  {format(txn.createdAt, "MMM d, yyyy HH:mm")}
                </TableCell>
                <TableCell onClick={(e) => e.stopPropagation()}>
                  <DropdownMenu>
                    <DropdownMenuTrigger asChild>
                      <Button variant="ghost" size="icon" className="h-8 w-8">
                        <MoreHorizontal className="w-4 h-4" />
                      </Button>
                    </DropdownMenuTrigger>
                    <DropdownMenuContent align="end" className="w-48">
                      <DropdownMenuItem onClick={() => navigate(`/admin/transactions/${txn.id}`)}>
                        <Eye className="w-4 h-4 mr-2" />
                        View details
                      </DropdownMenuItem>
                      {canWrite && (
                        <>
                          <DropdownMenuSeparator />
                          {txn.flagged ? (
                            <DropdownMenuItem onClick={() => handleUnflag(txn)}>
                              <FlagOff className="w-4 h-4 mr-2" />
                              Remove Flag
                            </DropdownMenuItem>
                          ) : (
                            <DropdownMenuItem
                              onClick={() => {
                                setSelectedTxn(txn);
                                setActionType("flag");
                              }}
                              className="text-destructive"
                            >
                              <Flag className="w-4 h-4 mr-2" />
                              Flag Transaction
                            </DropdownMenuItem>
                          )}
                          {txn.status === "completed" && txn.amount > 0 && (
                            <DropdownMenuItem
                              onClick={() => {
                                setSelectedTxn(txn);
                                setActionType("refund");
                              }}
                              className="text-accent"
                            >
                              <RefreshCw className="w-4 h-4 mr-2" />
                              Process Refund
                            </DropdownMenuItem>
                          )}
                        </>
                      )}
                    </DropdownMenuContent>
                  </DropdownMenu>
                </TableCell>
              </TableRow>
            ))
            )}
          </TableBody>
        </Table>
      </div>

      <div className="flex items-center justify-between">
        <p className="text-sm text-muted-foreground">
          Showing {transactions.length} of {transactionTotal} transactions (page {transactionPage} of {totalPages})
        </p>
        <div className="flex gap-2">
          <Button variant="outline" size="sm" disabled={page <= 1} onClick={() => setPage((p) => p - 1)}>
            Previous
          </Button>
          <Button variant="outline" size="sm" disabled={page >= totalPages} onClick={() => setPage((p) => p + 1)}>
            Next
          </Button>
        </div>
      </div>

      {/* Flag Dialog */}
      <Dialog 
        open={!!selectedTxn && actionType === "flag"} 
        onOpenChange={() => {
          setSelectedTxn(null);
          setActionType(null);
          setFlagReason("");
        }}
      >
        <DialogContent>
          <DialogHeader>
            <DialogTitle>Flag Transaction</DialogTitle>
            <DialogDescription>
              Flag this transaction for review. It will appear in the flagged queue.
            </DialogDescription>
          </DialogHeader>
          <div className="space-y-4 py-4">
            <div className="bg-muted p-4 rounded-lg space-y-2">
              <div className="flex justify-between">
                <span className="text-muted-foreground">Reference</span>
                <span className="font-mono">{selectedTxn?.reference}</span>
              </div>
              <div className="flex justify-between">
                <span className="text-muted-foreground">Amount</span>
                <span className="font-semibold">{formatCurrency(selectedTxn?.amount || 0, selectedTxn?.currency)}</span>
              </div>
            </div>
            <div className="space-y-2">
              <label className="text-sm font-medium">Reason for flagging</label>
              <Textarea
                placeholder="Enter reason..."
                value={flagReason}
                onChange={(e) => setFlagReason(e.target.value)}
              />
            </div>
          </div>
          <DialogFooter>
            <Button 
              variant="outline" 
              onClick={() => {
                setSelectedTxn(null);
                setActionType(null);
                setFlagReason("");
              }}
            >
              Cancel
            </Button>
            <Button 
              variant="destructive"
              onClick={handleFlag}
              disabled={!flagReason.trim()}
            >
              Flag Transaction
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      {/* Refund Dialog */}
      <Dialog 
        open={!!selectedTxn && actionType === "refund"} 
        onOpenChange={() => {
          setSelectedTxn(null);
          setActionType(null);
        }}
      >
        <DialogContent>
          <DialogHeader>
            <DialogTitle>Process Refund</DialogTitle>
            <DialogDescription>
              This will refund the transaction amount to the user's wallet.
            </DialogDescription>
          </DialogHeader>
          <div className="space-y-4 py-4">
            <div className="bg-muted p-4 rounded-lg space-y-2">
              <div className="flex justify-between">
                <span className="text-muted-foreground">User</span>
                <span className="font-medium">{selectedTxn?.userName}</span>
              </div>
              <div className="flex justify-between">
                <span className="text-muted-foreground">Amount</span>
                <span className="font-semibold text-success">
                  +{formatCurrency(selectedTxn?.amount || 0)}
                </span>
              </div>
              <div className="flex justify-between">
                <span className="text-muted-foreground">Reference</span>
                <span className="font-mono text-sm">{selectedTxn?.reference}</span>
              </div>
            </div>
          </div>
          <DialogFooter>
            <Button 
              variant="outline" 
              onClick={() => {
                setSelectedTxn(null);
                setActionType(null);
              }}
            >
              Cancel
            </Button>
            <Button onClick={handleRefund}>
              Confirm Refund
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </div>
  );
};
