import { useEffect, useState } from "react";
import { useSearchParams } from "react-router-dom";
import { format } from "date-fns";
import { Search, Loader2, RefreshCw, Undo2 } from "lucide-react";
import { toast } from "sonner";
import { Input } from "@/components/ui/input";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { Switch } from "@/components/ui/switch";
import { Label } from "@/components/ui/label";
import { Textarea } from "@/components/ui/textarea";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import { Sheet, SheetContent, SheetHeader, SheetTitle } from "@/components/ui/sheet";
import { Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { useAdminBundleOrder, useAdminBundleOrders, useAdminMutations } from "@/hooks/admin/useAdminQueries";
import { useAdminAuth } from "@/hooks/useAdminAuth";
import { can, type AdminBundleOrder } from "@/types/admin";

const STATUSES = ["awaiting_payment", "credited", "pending_float", "below_minimum", "failed", "expired"];

const formatAmount = (amount: number, currency: string) =>
  currency === "USDC"
    ? new Intl.NumberFormat("en-US", { style: "currency", currency: "USD", minimumFractionDigits: 2 }).format(amount)
    : new Intl.NumberFormat("en-NG", { style: "currency", currency: "NGN", minimumFractionDigits: 0 }).format(amount);

const label = (s: string) => s.replace(/_/g, " ");

const canCheck = (o: AdminBundleOrder) => o.currency === "NGN" && (o.status === "awaiting_payment" || o.status === "expired");

function RefundDialog({ order, onClose }: { order: AdminBundleOrder | null; onClose: () => void }) {
  const { recordBundleRefund } = useAdminMutations();
  const [reference, setReference] = useState("");
  const [amount, setAmount] = useState("");
  const [note, setNote] = useState("");
  const [saving, setSaving] = useState(false);

  // Reset only when a different order opens: background refetches replace the order object and
  // must not wipe what the admin is typing. The amount starts blank — the expected amount isn't
  // necessarily what the person paid.
  const orderId = order?.id;
  useEffect(() => {
    setReference("");
    setAmount("");
    setNote("");
  }, [orderId]);

  if (!order) return null;
  const naira = Number(amount);
  const ready = reference.trim() !== "" && Number.isFinite(naira) && naira > 0;

  const submit = async () => {
    setSaving(true);
    try {
      await recordBundleRefund(order.id, reference.trim(), naira, note.trim());
      toast.success("Refund recorded");
      onClose();
    } catch (err) {
      toast.error(err instanceof Error ? err.message : "That didn't work");
    } finally {
      setSaving(false);
    }
  };

  return (
    <Dialog open onOpenChange={(open) => !open && onClose()}>
      <DialogContent>
        <DialogHeader>
          <DialogTitle>Record outside refund</DialogTitle>
          <DialogDescription>
            Refund the person by bank transfer first, then record it here. This changes no wallet balance.
          </DialogDescription>
        </DialogHeader>
        <div className="space-y-4 py-2">
          <div className="bg-muted p-3 rounded-lg text-sm">
            <p className="font-medium">{order.userName || order.userId}</p>
            <p>{order.bundles} bundles · {formatAmount(order.amount, order.currency)} expected</p>
            {order.failureReason && <p className="text-muted-foreground">{order.failureReason}</p>}
          </div>
          <div className="space-y-2">
            <Label>Bank transfer reference</Label>
            <Input value={reference} onChange={(e) => setReference(e.target.value)} className="font-mono" />
          </div>
          <div className="space-y-2">
            <Label>Amount refunded (₦) — at most {formatAmount(order.amount, order.currency)}</Label>
            <Input type="number" min="0" step="0.01" value={amount} onChange={(e) => setAmount(e.target.value)} />
          </div>
          <div className="space-y-2">
            <Label>Note (optional)</Label>
            <Textarea value={note} onChange={(e) => setNote(e.target.value)} />
          </div>
        </div>
        <DialogFooter>
          <Button variant="outline" onClick={onClose}>Cancel</Button>
          <Button disabled={!ready || saving} onClick={submit}>
            {saving && <Loader2 className="w-4 h-4 mr-2 animate-spin" />}
            Record refund
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}

function OrderSheet({ id, onClose }: { id: string | null; onClose: () => void }) {
  const { session } = useAdminAuth();
  const canAct = can(session?.role, "transactions.write");
  const { data, isLoading } = useAdminBundleOrder(id);
  const { checkBundleOrder } = useAdminMutations();
  const [checking, setChecking] = useState(false);
  const [refunding, setRefunding] = useState(false);
  const o = data?.order;

  const check = async () => {
    if (!o) return;
    setChecking(true);
    try {
      const res = (await checkBundleOrder(o.id)) as { result?: { status?: string } } | undefined;
      const status = res?.result?.status;
      if (status === "credited") toast.success("Payment found — bundles credited");
      else if (status === "not_paid") toast.info("Flutterwave shows it unpaid");
      else if (status === "failed") toast.warning("Payment didn't match the order — it's now paid but failed");
      else toast.info(`Flutterwave: ${status ?? "no answer"}`);
    } catch (err) {
      toast.error(err instanceof Error ? err.message : "Check failed");
    } finally {
      setChecking(false);
    }
  };

  return (
    <Sheet open={!!id} onOpenChange={(open) => !open && onClose()}>
      <SheetContent className="w-full sm:max-w-lg overflow-y-auto">
        <SheetHeader>
          <SheetTitle>Bundle order</SheetTitle>
        </SheetHeader>
        {isLoading || !o ? (
          <p className="text-sm text-muted-foreground py-6">Loading…</p>
        ) : (
          <div className="space-y-5 py-4 text-sm">
            <div className="flex items-start justify-between">
              <div>
                <p className="text-2xl font-bold">{o.bundles} bundles</p>
                <p className="text-muted-foreground">{formatAmount(o.amount, o.currency)}</p>
              </div>
              <div className="flex flex-col items-end gap-1">
                <Badge variant="outline" className="capitalize">{label(o.status)}</Badge>
                {o.paidButFailed && <Badge variant="destructive">Paid but failed</Badge>}
              </div>
            </div>
            <div className="space-y-1">
              <p><span className="text-muted-foreground">Person:</span> {String(data?.user?.full_name ?? o.userName ?? "")} {data?.user?.email ? `· ${String(data.user.email)}` : ""}</p>
              <p><span className="text-muted-foreground">Order ref:</span> <span className="font-mono">{o.txRef}</span></p>
              {o.providerRef && <p><span className="text-muted-foreground">Payment ref:</span> <span className="font-mono">{o.providerRef}</span></p>}
              <p><span className="text-muted-foreground">Created:</span> {format(o.createdAt, "MMM d, yyyy HH:mm")}</p>
              {o.failureReason && <p className="text-destructive">{o.failureReason}</p>}
              {data?.creditTransaction && <p className="text-success">Credited to the person's Bag.</p>}
            </div>
            {o.refund && (
              <div className="rounded-lg border border-border p-3">
                <p className="font-medium mb-1">Refunded outside the app</p>
                <p>{formatAmount(o.refund.amount, "NGN")} · <span className="font-mono">{o.refund.reference}</span></p>
                {o.refund.note && <p>{o.refund.note}</p>}
                <p className="text-xs text-muted-foreground">{format(o.refund.at, "MMM d, yyyy HH:mm")}</p>
              </div>
            )}
            {canAct && (canCheck(o) || o.paidButFailed) && (
              <div className="flex flex-wrap gap-2">
                {canCheck(o) && (
                  <Button variant="outline" onClick={check} disabled={checking}>
                    {checking ? <Loader2 className="w-4 h-4 mr-2 animate-spin" /> : <RefreshCw className="w-4 h-4 mr-2" />}
                    Check with Flutterwave
                  </Button>
                )}
                {o.paidButFailed && (
                  <Button onClick={() => setRefunding(true)}>
                    <Undo2 className="w-4 h-4 mr-2" />
                    Record outside refund
                  </Button>
                )}
              </div>
            )}
          </div>
        )}
        <RefundDialog order={refunding ? o ?? null : null} onClose={() => setRefunding(false)} />
      </SheetContent>
    </Sheet>
  );
}

export const AdminBundleOrders = () => {
  const [params, setParams] = useSearchParams();
  const [status, setStatus] = useState(params.get("status") && STATUSES.includes(params.get("status")!) ? params.get("status")! : "all");
  const [currency, setCurrency] = useState("all");
  const [needsRefund, setNeedsRefund] = useState(params.get("needs_refund") === "1");
  const [searchQuery, setSearchQuery] = useState("");
  const [search, setSearch] = useState("");
  const [page, setPage] = useState(1);
  const openId = params.get("open");

  useEffect(() => {
    const t = setTimeout(() => setSearch(searchQuery), 300);
    return () => clearTimeout(t);
  }, [searchQuery]);

  useEffect(() => {
    setPage(1);
  }, [status, currency, needsRefund, search]);

  const { data, isFetching } = useAdminBundleOrders({ page, status, currency, needsRefund, search });
  const rows = data?.rows ?? [];
  const total = data?.total ?? 0;
  const totalPages = Math.max(1, Math.ceil(total / 50));

  const open = (id: string | null) => {
    const next = new URLSearchParams(params);
    if (id) next.set("open", id);
    else next.delete("open");
    setParams(next, { replace: true });
  };

  return (
    <div className="p-8 space-y-6">
      <div>
        <h1 className="text-3xl font-bold text-foreground">Bundle Orders</h1>
        <p className="text-muted-foreground mt-1">Bundle purchases (NGN checkout and USDC deposits)</p>
      </div>

      <div className="flex flex-wrap items-center gap-3">
        <div className="relative flex-1 min-w-[220px]">
          <Search className="absolute left-3 top-1/2 -translate-y-1/2 w-4 h-4 text-muted-foreground" />
          <Input className="pl-10" placeholder="Search order or payment reference…" value={searchQuery} onChange={(e) => setSearchQuery(e.target.value)} />
        </div>
        <Select value={status} onValueChange={setStatus}>
          <SelectTrigger className="w-[170px]"><SelectValue /></SelectTrigger>
          <SelectContent>
            <SelectItem value="all">All statuses</SelectItem>
            {STATUSES.map((s) => <SelectItem key={s} value={s} className="capitalize">{label(s)}</SelectItem>)}
          </SelectContent>
        </Select>
        <Select value={currency} onValueChange={setCurrency}>
          <SelectTrigger className="w-[130px]"><SelectValue /></SelectTrigger>
          <SelectContent>
            <SelectItem value="all">All currencies</SelectItem>
            <SelectItem value="NGN">NGN</SelectItem>
            <SelectItem value="USDC">USDC</SelectItem>
          </SelectContent>
        </Select>
        <div className="flex items-center gap-2">
          <Switch id="needs-refund" checked={needsRefund} onCheckedChange={setNeedsRefund} />
          <Label htmlFor="needs-refund">Needs refund</Label>
        </div>
      </div>

      <div className="bg-card rounded-xl border border-border overflow-hidden">
        <Table>
          <TableHeader>
            <TableRow className="border-border hover:bg-transparent">
              <TableHead className="text-muted-foreground">Time</TableHead>
              <TableHead className="text-muted-foreground">Person</TableHead>
              <TableHead className="text-muted-foreground">Bundles</TableHead>
              <TableHead className="text-muted-foreground">Amount</TableHead>
              <TableHead className="text-muted-foreground">Status</TableHead>
              <TableHead className="text-muted-foreground">Refund</TableHead>
            </TableRow>
          </TableHeader>
          <TableBody>
            {rows.length === 0 ? (
              <TableRow><TableCell colSpan={6} className="text-center py-8 text-muted-foreground">{isFetching ? "Loading…" : "No orders"}</TableCell></TableRow>
            ) : (
              rows.map((o) => (
                <TableRow key={o.id} className="border-border cursor-pointer" onClick={() => open(o.id)}>
                  <TableCell className="whitespace-nowrap text-sm">{format(o.createdAt, "MMM d, HH:mm")}</TableCell>
                  <TableCell>{o.userName || o.userId}</TableCell>
                  <TableCell>{o.bundles}</TableCell>
                  <TableCell className="font-medium">{formatAmount(o.amount, o.currency)}</TableCell>
                  <TableCell>
                    <div className="flex items-center gap-1">
                      <Badge variant="outline" className="capitalize">{label(o.status)}</Badge>
                      {o.paidButFailed && <Badge variant="destructive">Paid but failed</Badge>}
                    </div>
                  </TableCell>
                  <TableCell className="text-xs">{o.refund ? <span className="font-mono">✓ {o.refund.reference}</span> : "—"}</TableCell>
                </TableRow>
              ))
            )}
          </TableBody>
        </Table>
      </div>

      <div className="flex items-center justify-between">
        <p className="text-sm text-muted-foreground">Showing {rows.length} of {total} orders (page {page} of {totalPages})</p>
        <div className="flex gap-2">
          <Button variant="outline" size="sm" disabled={page <= 1} onClick={() => setPage((n) => n - 1)}>Previous</Button>
          <Button variant="outline" size="sm" disabled={page >= totalPages} onClick={() => setPage((n) => n + 1)}>Next</Button>
        </div>
      </div>

      <OrderSheet id={openId} onClose={() => open(null)} />
    </div>
  );
};
