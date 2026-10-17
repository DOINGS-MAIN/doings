import { useEffect, useState } from "react";
import { useSearchParams } from "react-router-dom";
import { format, formatDistanceToNow } from "date-fns";
import { Search, Loader2, RefreshCw, CheckCircle2, XCircle } from "lucide-react";
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
import { useAdminMutations, useAdminPayout, useAdminPayouts } from "@/hooks/admin/useAdminQueries";
import { useAdminAuth } from "@/hooks/useAdminAuth";
import { can, type AdminPayout } from "@/types/admin";

const formatAmount = (amount: number, currency: string) =>
  currency === "USDC"
    ? new Intl.NumberFormat("en-US", { style: "currency", currency: "USD", minimumFractionDigits: 2 }).format(amount)
    : new Intl.NumberFormat("en-NG", { style: "currency", currency: "NGN", minimumFractionDigits: 0 }).format(amount);

const statusBadge = (status: string) => {
  const cls: Record<string, string> = {
    completed: "bg-success/20 text-success border-0",
    failed: "bg-destructive/20 text-destructive border-0",
    pending: "bg-primary/20 text-primary border-0",
    processing: "bg-primary/20 text-primary border-0",
  };
  return <Badge className={`capitalize ${cls[status] ?? ""}`} variant={cls[status] ? undefined : "outline"}>{status}</Badge>;
};

const isOpen = (p: AdminPayout) => p.status === "pending" || p.status === "processing";
// USDC payouts settle by Blockradar webhook only, so there's no provider to ask.
const canAskProvider = (p: AdminPayout) => p.currency === "NGN" && p.provider !== "blockradar";

function ResolveDialog({
  payout,
  outcome,
  onClose,
}: {
  payout: AdminPayout | null;
  outcome: "paid" | "failed" | null;
  onClose: () => void;
}) {
  const { resolvePayout } = useAdminMutations();
  const [reason, setReason] = useState("");
  const [confirm, setConfirm] = useState("");
  const [saving, setSaving] = useState(false);

  useEffect(() => {
    setReason("");
    setConfirm("");
  }, [payout?.id, outcome]);

  if (!payout || !outcome) return null;
  const ready = reason.trim() !== "" && confirm.trim() === payout.reference;

  const submit = async () => {
    setSaving(true);
    try {
      await resolvePayout(payout.id, outcome, reason.trim(), confirm.trim());
      toast.success(outcome === "paid" ? "Payout marked paid" : "Payout marked failed — the user has their money back");
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
          <DialogTitle>Mark payout {outcome}</DialogTitle>
          <DialogDescription>
            {outcome === "paid"
              ? "Only do this when you've confirmed the money reached the person."
              : "The user gets the money (or bundles) back in their Bag. Only do this when you're sure the provider didn't pay."}
          </DialogDescription>
        </DialogHeader>
        <div className="space-y-4 py-2">
          <div className="bg-muted p-3 rounded-lg text-sm">
            <p className="font-medium">{payout.userName || payout.userId}</p>
            <p>{formatAmount(payout.amount, payout.currency)} · {payout.kind === "sale" ? "bundle sale" : "withdrawal"}</p>
          </div>
          <div className="space-y-2">
            <Label>Reason</Label>
            <Textarea value={reason} onChange={(e) => setReason(e.target.value)} placeholder="What did you check, and with whom?" />
          </div>
          <div className="space-y-2">
            <Label>
              Type the reference <span className="font-mono">{payout.reference}</span> to confirm
            </Label>
            <Input value={confirm} onChange={(e) => setConfirm(e.target.value)} className="font-mono" />
          </div>
        </div>
        <DialogFooter>
          <Button variant="outline" onClick={onClose}>Cancel</Button>
          <Button variant={outcome === "failed" ? "destructive" : "default"} disabled={!ready || saving} onClick={submit}>
            {saving && <Loader2 className="w-4 h-4 mr-2 animate-spin" />}
            Mark {outcome}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}

function PayoutSheet({ id, onClose }: { id: string | null; onClose: () => void }) {
  const { session } = useAdminAuth();
  const canAct = can(session?.role, "transactions.write");
  const { data, isLoading } = useAdminPayout(id);
  const { checkPayout } = useAdminMutations();
  const [checking, setChecking] = useState(false);
  const [resolving, setResolving] = useState<"paid" | "failed" | null>(null);
  const p = data?.payout;

  const check = async () => {
    if (!p) return;
    setChecking(true);
    try {
      const res = (await checkPayout(p.id)) as { normalized?: string; status?: string } | undefined;
      if (res?.normalized === "terminal_success") toast.success("Provider says paid — payout completed");
      else if (res?.normalized === "terminal_failure") toast.warning("Provider says failed — the user has their money back");
      else toast.info(`Provider: ${(res?.normalized ?? "no answer").replace(/_/g, " ")} — still open`);
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
          <SheetTitle>Payout</SheetTitle>
        </SheetHeader>
        {isLoading || !p ? (
          <p className="text-sm text-muted-foreground py-6">Loading…</p>
        ) : (
          <div className="space-y-5 py-4 text-sm">
            <div className="flex items-start justify-between">
              <div>
                <p className="text-2xl font-bold">{formatAmount(p.amount, p.currency)}</p>
                <p className="text-muted-foreground">
                  {p.kind === "sale" ? `Bundle sale${p.bundles ? ` · ${p.bundles} bundles` : ""}` : "Withdrawal"} · {p.provider ?? "—"}
                </p>
              </div>
              <div className="flex flex-col items-end gap-1">
                {statusBadge(p.status)}
                {p.needsReview && <Badge variant="destructive">Needs review</Badge>}
              </div>
            </div>

            <div className="space-y-1">
              <p><span className="text-muted-foreground">Person:</span> {String(data?.user?.full_name ?? p.userName ?? "")} {data?.user?.email ? `· ${String(data.user.email)}` : ""}</p>
              <p><span className="text-muted-foreground">Reference:</span> <span className="font-mono">{p.reference}</span></p>
              {p.providerRef && <p><span className="text-muted-foreground">Provider ref:</span> <span className="font-mono">{p.providerRef}</span></p>}
              <p><span className="text-muted-foreground">Created:</span> {format(p.createdAt, "MMM d, yyyy HH:mm")}</p>
              {p.failureReason && <p className="text-destructive">{p.failureReason}</p>}
            </div>

            <div className="rounded-lg border border-border p-3">
              <p className="font-medium mb-1">Last provider check</p>
              {p.lastCheck ? (
                <p>
                  {p.lastCheck.status.replace(/_/g, " ")}
                  {p.lastCheck.providerStatus && ` (${p.lastCheck.providerStatus})`} · {formatDistanceToNow(p.lastCheck.at, { addSuffix: true })}
                </p>
              ) : (
                <p className="text-muted-foreground">{canAskProvider(p) ? "Not checked from the admin yet." : "USDC payouts settle by webhook — there's no provider check."}</p>
              )}
            </div>

            {p.manualResolution && (
              <div className="rounded-lg border border-border p-3">
                <p className="font-medium mb-1">Resolved by an admin: {p.manualResolution.outcome}</p>
                <p>{p.manualResolution.reason}</p>
                <p className="text-xs text-muted-foreground">{format(p.manualResolution.at, "MMM d, yyyy HH:mm")}</p>
              </div>
            )}

            {canAct && isOpen(p) && (
              <div className="flex flex-wrap gap-2">
                {canAskProvider(p) && (
                  <Button variant="outline" onClick={check} disabled={checking}>
                    {checking ? <Loader2 className="w-4 h-4 mr-2 animate-spin" /> : <RefreshCw className="w-4 h-4 mr-2" />}
                    Check with provider
                  </Button>
                )}
                <Button onClick={() => setResolving("paid")}>
                  <CheckCircle2 className="w-4 h-4 mr-2" />
                  Mark paid
                </Button>
                <Button variant="destructive" onClick={() => setResolving("failed")}>
                  <XCircle className="w-4 h-4 mr-2" />
                  Mark failed
                </Button>
              </div>
            )}

            <div>
              <p className="font-medium mb-2">Provider activity</p>
              {(data?.pspEvents ?? []).length === 0 ? (
                <p className="text-muted-foreground">None recorded.</p>
              ) : (
                <div className="space-y-1">
                  {data!.pspEvents.map((e) => (
                    <div key={String(e.id)} className="flex justify-between border-b border-border last:border-0 py-1">
                      <span>{String(e.event_type ?? "")} · {String(e.status ?? e.provider_status ?? "")}</span>
                      <span className="text-xs text-muted-foreground">{formatDistanceToNow(new Date(String(e.created_at)), { addSuffix: true })}</span>
                    </div>
                  ))}
                </div>
              )}
            </div>

            <div>
              <p className="font-medium mb-2">Webhooks</p>
              {(data?.webhooks ?? []).length === 0 ? (
                <p className="text-muted-foreground">None received.</p>
              ) : (
                <div className="space-y-1">
                  {data!.webhooks.map((w) => (
                    <div key={String(w.id)} className="flex justify-between border-b border-border last:border-0 py-1">
                      <span>{String(w.provider ?? "")} · {String(w.event_type ?? "")} {w.processed ? "" : "(unprocessed)"}</span>
                      <span className="text-xs text-muted-foreground">{formatDistanceToNow(new Date(String(w.created_at)), { addSuffix: true })}</span>
                    </div>
                  ))}
                </div>
              )}
            </div>
          </div>
        )}
        <ResolveDialog payout={p ?? null} outcome={resolving} onClose={() => setResolving(null)} />
      </SheetContent>
    </Sheet>
  );
}

export const AdminPayouts = () => {
  const [params, setParams] = useSearchParams();
  const [status, setStatus] = useState("all");
  const [currency, setCurrency] = useState("all");
  const [kind, setKind] = useState("all");
  const [needsReview, setNeedsReview] = useState(params.get("needs_review") === "1");
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
  }, [status, currency, kind, needsReview, search]);

  const { data, isFetching } = useAdminPayouts({ page, status, currency, kind, needsReview, search });
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
        <h1 className="text-3xl font-bold text-foreground">Payouts</h1>
        <p className="text-muted-foreground mt-1">Bank and USDC payouts, including bundle sales</p>
      </div>

      <div className="flex flex-wrap items-center gap-3">
        <div className="relative flex-1 min-w-[220px]">
          <Search className="absolute left-3 top-1/2 -translate-y-1/2 w-4 h-4 text-muted-foreground" />
          <Input className="pl-10" placeholder="Search reference or description…" value={searchQuery} onChange={(e) => setSearchQuery(e.target.value)} />
        </div>
        <Select value={status} onValueChange={setStatus}>
          <SelectTrigger className="w-[150px]"><SelectValue /></SelectTrigger>
          <SelectContent>
            <SelectItem value="all">All statuses</SelectItem>
            <SelectItem value="pending">Pending</SelectItem>
            <SelectItem value="processing">Processing</SelectItem>
            <SelectItem value="completed">Completed</SelectItem>
            <SelectItem value="failed">Failed</SelectItem>
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
        <Select value={kind} onValueChange={setKind}>
          <SelectTrigger className="w-[140px]"><SelectValue /></SelectTrigger>
          <SelectContent>
            <SelectItem value="all">All kinds</SelectItem>
            <SelectItem value="sale">Bundle sales</SelectItem>
            <SelectItem value="withdrawal">Withdrawals</SelectItem>
          </SelectContent>
        </Select>
        <div className="flex items-center gap-2">
          <Switch id="needs-review" checked={needsReview} onCheckedChange={setNeedsReview} />
          <Label htmlFor="needs-review">Needs review</Label>
        </div>
      </div>

      <div className="bg-card rounded-xl border border-border overflow-hidden">
        <Table>
          <TableHeader>
            <TableRow className="border-border hover:bg-transparent">
              <TableHead className="text-muted-foreground">Time</TableHead>
              <TableHead className="text-muted-foreground">Person</TableHead>
              <TableHead className="text-muted-foreground">Kind</TableHead>
              <TableHead className="text-muted-foreground">Amount</TableHead>
              <TableHead className="text-muted-foreground">Status</TableHead>
              <TableHead className="text-muted-foreground">Reference</TableHead>
            </TableRow>
          </TableHeader>
          <TableBody>
            {rows.length === 0 ? (
              <TableRow><TableCell colSpan={6} className="text-center py-8 text-muted-foreground">{isFetching ? "Loading…" : "No payouts"}</TableCell></TableRow>
            ) : (
              rows.map((p) => (
                <TableRow key={p.id} className="border-border cursor-pointer" onClick={() => open(p.id)}>
                  <TableCell className="whitespace-nowrap text-sm">{format(p.createdAt, "MMM d, HH:mm")}</TableCell>
                  <TableCell>{p.userName || p.userId}</TableCell>
                  <TableCell className="text-sm">{p.kind === "sale" ? `Sale${p.bundles ? ` · ${p.bundles}` : ""}` : "Withdrawal"}</TableCell>
                  <TableCell className="font-medium">{formatAmount(p.amount, p.currency)}</TableCell>
                  <TableCell>
                    <div className="flex items-center gap-1">
                      {statusBadge(p.status)}
                      {p.needsReview && <Badge variant="destructive">Review</Badge>}
                    </div>
                  </TableCell>
                  <TableCell className="font-mono text-xs">{p.reference}</TableCell>
                </TableRow>
              ))
            )}
          </TableBody>
        </Table>
      </div>

      <div className="flex items-center justify-between">
        <p className="text-sm text-muted-foreground">Showing {rows.length} of {total} payouts (page {page} of {totalPages})</p>
        <div className="flex gap-2">
          <Button variant="outline" size="sm" disabled={page <= 1} onClick={() => setPage((n) => n - 1)}>Previous</Button>
          <Button variant="outline" size="sm" disabled={page >= totalPages} onClick={() => setPage((n) => n + 1)}>Next</Button>
        </div>
      </div>

      <PayoutSheet id={openId} onClose={() => open(null)} />
    </div>
  );
};
