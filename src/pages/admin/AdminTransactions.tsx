import { useState } from "react";
import { 
  Search, 
  Filter, 
  MoreHorizontal,
  RefreshCw,
  Flag,
  FlagOff,
  Download,
  AlertTriangle
} from "lucide-react";
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
import { AdminTransaction } from "@/types/admin";
import { format, formatDistanceToNow } from "date-fns";
import { toast } from "sonner";

export const AdminTransactions = () => {
  const { transactions, getStats, refundTransaction, flagTransaction, unflagTransaction } = useAdminData();
  const stats = getStats();
  const [searchQuery, setSearchQuery] = useState("");
  const [typeFilter, setTypeFilter] = useState<string>("all");
  const [statusFilter, setStatusFilter] = useState<string>("all");
  const [flagFilter, setFlagFilter] = useState<string>("all");
  const [selectedTxn, setSelectedTxn] = useState<AdminTransaction | null>(null);
  const [actionType, setActionType] = useState<"flag" | "refund" | null>(null);
  const [flagReason, setFlagReason] = useState("");

  const formatCurrency = (amount: number) => {
    return new Intl.NumberFormat("en-NG", {
      style: "currency",
      currency: "NGN",
      minimumFractionDigits: 0,
    }).format(Math.abs(amount));
  };

  const filteredTransactions = transactions
    .filter((txn) => {
      const matchesSearch = 
        txn.userName.toLowerCase().includes(searchQuery.toLowerCase()) ||
        txn.reference.toLowerCase().includes(searchQuery.toLowerCase());
      
      const matchesType = typeFilter === "all" || txn.type === typeFilter;
      const matchesStatus = statusFilter === "all" || txn.status === statusFilter;
      const matchesFlag = flagFilter === "all" || 
        (flagFilter === "flagged" && txn.flagged) ||
        (flagFilter === "unflagged" && !txn.flagged);
      
      return matchesSearch && matchesType && matchesStatus && matchesFlag;
    })
    .sort((a, b) => b.createdAt.getTime() - a.createdAt.getTime());

  const getStatusBadge = (status: AdminTransaction["status"]) => {
    switch (status) {
      case "completed":
        return <Badge className="bg-success/20 text-success border-0">Completed</Badge>;
      case "pending":
        return <Badge className="bg-primary/20 text-primary border-0">Pending</Badge>;
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

  const handleFlag = () => {
    if (!selectedTxn) return;
    flagTransaction(selectedTxn.id, flagReason);
    toast.success("Transaction flagged for review");
    setSelectedTxn(null);
    setActionType(null);
    setFlagReason("");
  };

  const handleUnflag = (txn: AdminTransaction) => {
    unflagTransaction(txn.id);
    toast.success("Transaction unflagged");
  };

  const handleRefund = () => {
    if (!selectedTxn) return;
    refundTransaction(selectedTxn.id);
    toast.success("Transaction refunded successfully");
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
            <SelectItem value="failed">Failed</SelectItem>
            <SelectItem value="refunded">Refunded</SelectItem>
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
        <Button variant="outline" className="gap-2">
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
              <TableHead className="text-muted-foreground">Status</TableHead>
              <TableHead className="text-muted-foreground">Date</TableHead>
              <TableHead className="text-muted-foreground w-[50px]"></TableHead>
            </TableRow>
          </TableHeader>
          <TableBody>
            {filteredTransactions.map((txn) => (
              <TableRow 
                key={txn.id} 
                className={`border-border ${txn.flagged ? "bg-destructive/5" : ""}`}
              >
                <TableCell>
                  <div className="flex items-center gap-2">
                    {txn.flagged && <Flag className="w-4 h-4 text-destructive" />}
                    <span className="font-mono text-sm">{txn.reference}</span>
                  </div>
                </TableCell>
                <TableCell>
                  <p className="font-medium text-foreground">{txn.userName}</p>
                </TableCell>
                <TableCell>{getTypeBadge(txn.type)}</TableCell>
                <TableCell>
                  <span className={`font-semibold ${txn.amount >= 0 ? "text-success" : "text-foreground"}`}>
                    {txn.amount >= 0 ? "+" : "-"}{formatCurrency(txn.amount)}
                  </span>
                </TableCell>
                <TableCell>{getStatusBadge(txn.status)}</TableCell>
                <TableCell className="text-sm text-muted-foreground">
                  {format(txn.createdAt, "MMM d, yyyy HH:mm")}
                </TableCell>
                <TableCell>
                  <DropdownMenu>
                    <DropdownMenuTrigger asChild>
                      <Button variant="ghost" size="icon" className="h-8 w-8">
                        <MoreHorizontal className="w-4 h-4" />
                      </Button>
                    </DropdownMenuTrigger>
                    <DropdownMenuContent align="end" className="w-48">
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
                        <>
                          <DropdownMenuSeparator />
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
                        </>
                      )}
                    </DropdownMenuContent>
                  </DropdownMenu>
                </TableCell>
              </TableRow>
            ))}
          </TableBody>
        </Table>
      </div>

      {/* Results count */}
      <p className="text-sm text-muted-foreground">
        Showing {filteredTransactions.length} of {transactions.length} transactions
      </p>

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
                <span className="font-semibold">{formatCurrency(selectedTxn?.amount || 0)}</span>
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
