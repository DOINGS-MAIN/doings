import { useEffect, useState } from "react";
import { Link, useSearchParams } from "react-router-dom";
import { format, formatDistanceToNow } from "date-fns";
import { Loader2, Search, StopCircle, X } from "lucide-react";
import { toast } from "sonner";
import { Input } from "@/components/ui/input";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { Label } from "@/components/ui/label";
import { Textarea } from "@/components/ui/textarea";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import { Sheet, SheetContent, SheetHeader, SheetTitle } from "@/components/ui/sheet";
import { Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { useAdminGiveaway, useAdminGiveaways, useAdminMutations } from "@/hooks/admin/useAdminQueries";
import { useAdminAuth } from "@/hooks/useAdminAuth";
import { can, type AdminGiveaway } from "@/types/admin";

const naira = (n: number) =>
  new Intl.NumberFormat("en-NG", { style: "currency", currency: "NGN", minimumFractionDigits: 0 }).format(n);

const statusBadge = (status: AdminGiveaway["status"]) => {
  if (status === "active") return <Badge className="bg-success/20 text-success border-0">Active</Badge>;
  if (status === "stopped") return <Badge variant="destructive">Stopped</Badge>;
  return <Badge variant="outline" className="text-muted-foreground">Exhausted</Badge>;
};

function StopDialog({ giveaway, onClose }: { giveaway: AdminGiveaway; onClose: () => void }) {
  const { stopGiveaway } = useAdminMutations();
  const [reason, setReason] = useState("");
  const [confirm, setConfirm] = useState("");
  const [saving, setSaving] = useState(false);
  const ready = reason.trim() !== "" && confirm.trim().toUpperCase() === giveaway.code.toUpperCase();

  const submit = async () => {
    setSaving(true);
    try {
      const res = (await stopGiveaway(giveaway.id, reason.trim(), confirm.trim())) as { refunded?: number } | undefined;
      const refunded = Number(res?.refunded ?? 0) / 100;
      toast.success(refunded > 0 ? `Giveaway stopped — ${naira(refunded)} returned to the creator` : "Giveaway stopped");
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
          <DialogTitle>Stop giveaway</DialogTitle>
          <DialogDescription>
            Nobody else can claim it. What's left ({naira(giveaway.remaining)}) goes back to the creator's Bag, and they're told why.
          </DialogDescription>
        </DialogHeader>
        <div className="space-y-4 py-2">
          <div className="space-y-2">
            <Label>Reason (the creator will see this)</Label>
            <Textarea value={reason} onChange={(e) => setReason(e.target.value)} />
          </div>
          <div className="space-y-2">
            <Label>Type the code <span className="font-mono">{giveaway.code}</span> to confirm</Label>
            <Input value={confirm} onChange={(e) => setConfirm(e.target.value)} className="font-mono" />
          </div>
        </div>
        <DialogFooter>
          <Button variant="outline" onClick={onClose}>Cancel</Button>
          <Button variant="destructive" disabled={!ready || saving} onClick={submit}>
            {saving && <Loader2 className="w-4 h-4 mr-2 animate-spin" />}
            Stop giveaway
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}

function GiveawaySheet({ id, onClose }: { id: string | null; onClose: () => void }) {
  const { session } = useAdminAuth();
  const canStop = can(session?.role, "giveaways.stop");
  const { data, isLoading } = useAdminGiveaway(id);
  const [stopping, setStopping] = useState(false);
  const g = data?.giveaway;

  return (
    <Sheet open={!!id} onOpenChange={(open) => !open && onClose()}>
      <SheetContent className="w-full sm:max-w-lg overflow-y-auto">
        <SheetHeader>
          <SheetTitle>Giveaway</SheetTitle>
        </SheetHeader>
        {isLoading || !g || !data ? (
          <p className="text-sm text-muted-foreground py-6">Loading…</p>
        ) : (
          <div className="space-y-5 py-4 text-sm">
            <div className="flex items-start justify-between">
              <div>
                <p className="text-xl font-bold">{g.title}</p>
                <p className="font-mono text-muted-foreground">{g.code}</p>
              </div>
              <div className="flex flex-col items-end gap-1">
                {statusBadge(g.status)}
                <Badge variant="outline" className="capitalize">{g.type}</Badge>
              </div>
            </div>

            <div className="grid grid-cols-2 gap-3">
              <div><p className="text-muted-foreground">Total</p><p className="font-medium">{naira(g.total)}</p></div>
              <div><p className="text-muted-foreground">Per person</p><p className="font-medium">{naira(g.perPerson)}</p></div>
              <div><p className="text-muted-foreground">Remaining</p><p className="font-medium">{naira(g.remaining)}</p></div>
              <div><p className="text-muted-foreground">Recipients</p><p className="font-medium">{g.redeemedCount} of {g.maxRecipients}</p></div>
            </div>

            <div className="space-y-1">
              <p>
                <span className="text-muted-foreground">Creator:</span>{" "}
                {data.creator ? (
                  <Link to={`/admin/users/${data.creator.id}`} className="hover:underline">{data.creator.name || data.creator.email || data.creator.id}</Link>
                ) : "—"}
              </p>
              {data.event && (
                <p><span className="text-muted-foreground">Event:</span> {data.event.title} · <span className="font-mono">{data.event.code}</span></p>
              )}
              <p><span className="text-muted-foreground">Created:</span> {format(g.createdAt, "MMM d, yyyy HH:mm")}</p>
              {data.fundingTransactionId && (
                <p><Link to={`/admin/transactions/${data.fundingTransactionId}`} className="hover:underline">Funding transaction</Link></p>
              )}
              {data.refundTransactionId && (
                <p><Link to={`/admin/transactions/${data.refundTransactionId}`} className="hover:underline">Refund transaction</Link></p>
              )}
            </div>

            {g.status === "stopped" && (
              <div className="rounded-lg border border-border p-3">
                <p className="font-medium">
                  Stopped {g.stoppedAt ? formatDistanceToNow(g.stoppedAt, { addSuffix: true }) : ""}
                  {data.stoppedByEmail ? ` by ${data.stoppedByEmail}` : ""}
                </p>
                {g.stopReason && <p>{g.stopReason}</p>}
              </div>
            )}

            {g.status === "active" && canStop && (
              <Button variant="destructive" onClick={() => setStopping(true)}>
                <StopCircle className="w-4 h-4 mr-2" />
                Stop giveaway
              </Button>
            )}

            <div>
              <p className="font-medium mb-2">Redemptions ({data.redemptions.length}{data.redemptions.length >= 500 ? ", first 500 shown" : ""})</p>
              {data.redemptions.length === 0 ? (
                <p className="text-muted-foreground">Nobody has claimed it yet.</p>
              ) : (
                data.redemptions.map((r) => (
                  <div key={r.id} className="flex justify-between py-1 border-b border-border last:border-0">
                    <Link to={`/admin/users/${r.userId}`} className="hover:underline">{r.userName || r.userId}</Link>
                    <span>{naira(r.amount)} · <span className="text-xs text-muted-foreground">{format(r.redeemedAt, "MMM d, HH:mm")}</span></span>
                  </div>
                ))
              )}
            </div>
          </div>
        )}
        {stopping && g && <StopDialog giveaway={g} onClose={() => setStopping(false)} />}
      </SheetContent>
    </Sheet>
  );
}

export const AdminGiveaways = () => {
  const [params, setParams] = useSearchParams();
  const [status, setStatus] = useState("all");
  const [type, setType] = useState("all");
  const [searchQuery, setSearchQuery] = useState("");
  const [search, setSearch] = useState("");
  const [page, setPage] = useState(1);
  const creatorId = params.get("creator") ?? "";
  const openId = params.get("open");

  useEffect(() => {
    const t = setTimeout(() => setSearch(searchQuery), 300);
    return () => clearTimeout(t);
  }, [searchQuery]);

  useEffect(() => {
    setPage(1);
  }, [status, type, search, creatorId]);

  const { data, isFetching } = useAdminGiveaways({ page, status, type, creatorId, search });
  const rows = data?.rows ?? [];
  const total = data?.total ?? 0;
  const totalPages = Math.max(1, Math.ceil(total / 50));

  const setParam = (key: string, value: string | null) => {
    const next = new URLSearchParams(params);
    if (value) next.set(key, value);
    else next.delete(key);
    setParams(next, { replace: true });
  };

  return (
    <div className="p-8 space-y-6">
      <div>
        <h1 className="text-3xl font-bold text-foreground">Giveaways</h1>
        <p className="text-muted-foreground mt-1">Every giveaway, who claimed it, and what's left</p>
      </div>

      <div className="flex flex-wrap items-center gap-3">
        <div className="relative flex-1 min-w-[220px]">
          <Search className="absolute left-3 top-1/2 -translate-y-1/2 w-4 h-4 text-muted-foreground" />
          <Input className="pl-10" placeholder="Search code or title…" value={searchQuery} onChange={(e) => setSearchQuery(e.target.value)} />
        </div>
        <Select value={status} onValueChange={setStatus}>
          <SelectTrigger className="w-[150px]"><SelectValue /></SelectTrigger>
          <SelectContent>
            <SelectItem value="all">All statuses</SelectItem>
            <SelectItem value="active">Active</SelectItem>
            <SelectItem value="stopped">Stopped</SelectItem>
            <SelectItem value="exhausted">Exhausted</SelectItem>
          </SelectContent>
        </Select>
        <Select value={type} onValueChange={setType}>
          <SelectTrigger className="w-[140px]"><SelectValue /></SelectTrigger>
          <SelectContent>
            <SelectItem value="all">All types</SelectItem>
            <SelectItem value="live">Live</SelectItem>
            <SelectItem value="scheduled">Scheduled</SelectItem>
          </SelectContent>
        </Select>
        {creatorId && (
          <Badge variant="outline" className="gap-1 h-8 px-3">
            Creator: {rows[0]?.creatorName || "selected user"}
            <button type="button" aria-label="Clear creator filter" onClick={() => setParam("creator", null)}>
              <X className="w-3 h-3" />
            </button>
          </Badge>
        )}
      </div>

      <div className="bg-card rounded-xl border border-border overflow-hidden">
        <Table>
          <TableHeader>
            <TableRow className="border-border hover:bg-transparent">
              <TableHead className="text-muted-foreground">Created</TableHead>
              <TableHead className="text-muted-foreground">Giveaway</TableHead>
              <TableHead className="text-muted-foreground">Creator</TableHead>
              <TableHead className="text-muted-foreground">Total</TableHead>
              <TableHead className="text-muted-foreground">Per person</TableHead>
              <TableHead className="text-muted-foreground">Remaining</TableHead>
              <TableHead className="text-muted-foreground">Recipients</TableHead>
              <TableHead className="text-muted-foreground">Status</TableHead>
            </TableRow>
          </TableHeader>
          <TableBody>
            {rows.length === 0 ? (
              <TableRow><TableCell colSpan={8} className="text-center py-8 text-muted-foreground">{isFetching ? "Loading…" : "No giveaways"}</TableCell></TableRow>
            ) : (
              rows.map((g) => (
                <TableRow key={g.id} className="border-border cursor-pointer" onClick={() => setParam("open", g.id)}>
                  <TableCell className="whitespace-nowrap text-sm">{format(g.createdAt, "MMM d, HH:mm")}</TableCell>
                  <TableCell>
                    <p className="font-medium">{g.title}</p>
                    <p className="font-mono text-xs text-muted-foreground">{g.code} · <span className="capitalize">{g.type}</span></p>
                  </TableCell>
                  <TableCell>{g.creatorName || g.creatorId}</TableCell>
                  <TableCell>{naira(g.total)}</TableCell>
                  <TableCell>{naira(g.perPerson)}</TableCell>
                  <TableCell>{naira(g.remaining)}</TableCell>
                  <TableCell>{g.redeemedCount}/{g.maxRecipients}</TableCell>
                  <TableCell>{statusBadge(g.status)}</TableCell>
                </TableRow>
              ))
            )}
          </TableBody>
        </Table>
      </div>

      <div className="flex items-center justify-between">
        <p className="text-sm text-muted-foreground">Showing {rows.length} of {total} giveaways (page {page} of {totalPages})</p>
        <div className="flex gap-2">
          <Button variant="outline" size="sm" disabled={page <= 1} onClick={() => setPage((n) => n - 1)}>Previous</Button>
          <Button variant="outline" size="sm" disabled={page >= totalPages} onClick={() => setPage((n) => n + 1)}>Next</Button>
        </div>
      </div>

      <GiveawaySheet id={openId} onClose={() => setParam("open", null)} />
    </div>
  );
};
