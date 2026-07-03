import { useEffect, useState } from "react";
import { useSearchParams } from "react-router-dom";
import { format, formatDistanceToNow } from "date-fns";
import { Eye, Download, Loader2, RefreshCw, RotateCcw, Search } from "lucide-react";
import { Card, CardContent } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from "@/components/ui/table";
import { useAdminMonitoring } from "@/hooks/useAdminMonitoring";
import { useAdminAuth } from "@/hooks/useAdminAuth";
import { canWriteWebhooks } from "@/lib/adminPermissions";
import { admin as adminApi } from "@/lib/supabase";
import { toast } from "sonner";
import type { WebhookLogDetail, WebhookLogSummary } from "@/types/admin";

export const AdminWebhooks = () => {
  const [searchParams] = useSearchParams();
  const { currentAccount } = useAdminAuth();
  const canWrite = currentAccount ? canWriteWebhooks(currentAccount.role) : false;
  const { fetchWebhooks, fetchWebhookDetail, reprocessWebhook } = useAdminMonitoring();

  const [webhooks, setWebhooks] = useState<WebhookLogSummary[]>([]);
  const [total, setTotal] = useState(0);
  const [page, setPage] = useState(1);
  const [loading, setLoading] = useState(true);
  const [search, setSearch] = useState("");
  const [debouncedSearch, setDebouncedSearch] = useState("");
  const [providerFilter, setProviderFilter] = useState("all");
  const [processedFilter, setProcessedFilter] = useState(searchParams.get("processed") ?? "all");
  const [selected, setSelected] = useState<WebhookLogDetail | null>(null);
  const [detailLoading, setDetailLoading] = useState(false);

  const highlightId = searchParams.get("highlight");

  useEffect(() => {
    const t = setTimeout(() => setDebouncedSearch(search), 300);
    return () => clearTimeout(t);
  }, [search]);

  useEffect(() => {
    setPage(1);
  }, [debouncedSearch, providerFilter, processedFilter]);

  const load = async () => {
    setLoading(true);
    try {
      const res = await fetchWebhooks({
        page,
        limit: 50,
        provider: providerFilter !== "all" ? providerFilter : undefined,
        processed: processedFilter !== "all" ? processedFilter : undefined,
        search: debouncedSearch || undefined,
      });
      setWebhooks(res.webhooks);
      setTotal(res.total);
    } catch (err) {
      toast.error(err instanceof Error ? err.message : "Failed to load webhooks");
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => {
    load();
  }, [page, debouncedSearch, providerFilter, processedFilter]);

  useEffect(() => {
    if (!highlightId) return;
    setDetailLoading(true);
    fetchWebhookDetail(highlightId)
      .then(setSelected)
      .finally(() => setDetailLoading(false));
  }, [highlightId, fetchWebhookDetail]);

  const openDetail = async (id: string) => {
    setDetailLoading(true);
    try {
      setSelected(await fetchWebhookDetail(id));
    } finally {
      setDetailLoading(false);
    }
  };

  const handleReprocess = async (id: string) => {
    try {
      const res = (await reprocessWebhook(id)) as { ok?: boolean; message?: string };
      toast.success(res.message ?? (res.ok ? "Webhook reprocessed" : "Reprocess finished"));
      await load();
    } catch (err) {
      toast.error(err instanceof Error ? err.message : "Reprocess failed");
    }
  };

  const handleExport = async () => {
    await adminApi.webhooks.exportCsv({
      ...(providerFilter !== "all" ? { provider: providerFilter } : {}),
      ...(processedFilter !== "all" ? { processed: processedFilter } : {}),
      ...(debouncedSearch ? { search: debouncedSearch } : {}),
    });
  };

  const totalPages = Math.max(1, Math.ceil(total / 50));

  return (
    <div className="p-8 space-y-6">
      <div className="flex items-start justify-between gap-4">
        <div>
          <h1 className="text-3xl font-bold text-foreground">Webhook Logs</h1>
          <p className="text-muted-foreground mt-1">Inbound PSP webhook deliveries and processing status</p>
        </div>
        <Button variant="outline" onClick={handleExport}>
          <Download className="w-4 h-4 mr-2" />
          Export CSV
        </Button>
        <Button variant="outline" onClick={load} disabled={loading}>
          <RefreshCw className={`w-4 h-4 mr-2 ${loading ? "animate-spin" : ""}`} />
          Refresh
        </Button>
      </div>

      <div className="flex flex-col sm:flex-row gap-4">
        <div className="relative flex-1">
          <Search className="absolute left-3 top-1/2 -translate-y-1/2 w-4 h-4 text-muted-foreground" />
          <Input
            placeholder="Search idempotency key or event type..."
            value={search}
            onChange={(e) => setSearch(e.target.value)}
            className="pl-10"
          />
        </div>
        <Select value={providerFilter} onValueChange={setProviderFilter}>
          <SelectTrigger className="w-[140px]">
            <SelectValue placeholder="Provider" />
          </SelectTrigger>
          <SelectContent>
            <SelectItem value="all">All providers</SelectItem>
            <SelectItem value="monnify">Monnify</SelectItem>
            <SelectItem value="nomba">Nomba</SelectItem>
            <SelectItem value="flutterwave">Flutterwave</SelectItem>
            <SelectItem value="blockradar">Blockradar</SelectItem>
            <SelectItem value="quidax">Quidax</SelectItem>
          </SelectContent>
        </Select>
        <Select value={processedFilter} onValueChange={setProcessedFilter}>
          <SelectTrigger className="w-[140px]">
            <SelectValue placeholder="Status" />
          </SelectTrigger>
          <SelectContent>
            <SelectItem value="all">All</SelectItem>
            <SelectItem value="false">Unprocessed</SelectItem>
            <SelectItem value="true">Processed</SelectItem>
          </SelectContent>
        </Select>
      </div>

      <Card className="overflow-hidden">
        <CardContent className="p-0">
          <Table>
            <TableHeader>
              <TableRow>
                <TableHead>Provider</TableHead>
                <TableHead>Event</TableHead>
                <TableHead>Idempotency key</TableHead>
                <TableHead>Signature</TableHead>
                <TableHead>Status</TableHead>
                <TableHead>Received</TableHead>
                <TableHead className="w-12" />
              </TableRow>
            </TableHeader>
            <TableBody>
              {loading ? (
                <TableRow>
                  <TableCell colSpan={7} className="text-center py-8 text-muted-foreground">
                    <Loader2 className="w-4 h-4 animate-spin inline mr-2" />
                    Loading…
                  </TableCell>
                </TableRow>
              ) : webhooks.length === 0 ? (
                <TableRow>
                  <TableCell colSpan={7} className="text-center py-8 text-muted-foreground">
                    No webhook logs found
                  </TableCell>
                </TableRow>
              ) : (
                webhooks.map((wh) => (
                  <TableRow
                    key={wh.id}
                    className={wh.id === highlightId ? "bg-primary/5" : undefined}
                  >
                    <TableCell className="capitalize font-medium">{wh.provider}</TableCell>
                    <TableCell className="text-sm">{wh.eventType ?? "—"}</TableCell>
                    <TableCell className="font-mono text-xs max-w-[200px] truncate">
                      {wh.idempotencyKey ?? "—"}
                    </TableCell>
                    <TableCell>
                      {wh.signatureValid === false ? (
                        <Badge variant="destructive" className="text-xs">Invalid</Badge>
                      ) : wh.signatureValid ? (
                        <Badge className="bg-success/20 text-success border-0 text-xs">Valid</Badge>
                      ) : (
                        <span className="text-muted-foreground text-xs">—</span>
                      )}
                    </TableCell>
                    <TableCell>
                      {wh.processed ? (
                        <Badge variant="secondary" className="text-xs">Processed</Badge>
                      ) : (
                        <Badge variant="destructive" className="text-xs">Pending</Badge>
                      )}
                      {wh.processingError && (
                        <p className="text-xs text-destructive mt-1 truncate max-w-[160px]" title={wh.processingError}>
                          {wh.processingError}
                        </p>
                      )}
                    </TableCell>
                    <TableCell className="text-sm text-muted-foreground">
                      {formatDistanceToNow(wh.createdAt, { addSuffix: true })}
                    </TableCell>
                    <TableCell>
                      <div className="flex gap-1">
                        <Button variant="ghost" size="icon" className="h-8 w-8" onClick={() => openDetail(wh.id)}>
                          <Eye className="w-4 h-4" />
                        </Button>
                        {canWrite && !wh.processed && (
                          <Button variant="ghost" size="icon" className="h-8 w-8" onClick={() => handleReprocess(wh.id)} title="Reprocess">
                            <RotateCcw className="w-4 h-4" />
                          </Button>
                        )}
                      </div>
                    </TableCell>
                  </TableRow>
                ))
              )}
            </TableBody>
          </Table>
        </CardContent>
      </Card>

      <div className="flex items-center justify-between">
        <p className="text-sm text-muted-foreground">
          {webhooks.length} of {total} (page {page} of {totalPages})
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

      <Dialog open={Boolean(selected) || detailLoading} onOpenChange={(open) => !open && setSelected(null)}>
        <DialogContent className="max-w-2xl max-h-[85vh] overflow-y-auto">
          <DialogHeader>
            <DialogTitle>Webhook detail</DialogTitle>
          </DialogHeader>
          {detailLoading && !selected ? (
            <div className="py-8 text-center text-muted-foreground">
              <Loader2 className="w-5 h-5 animate-spin inline mr-2" />
              Loading…
            </div>
          ) : selected ? (
            <div className="space-y-4 text-sm">
              <div className="grid grid-cols-2 gap-3">
                <div>
                  <p className="text-muted-foreground">Provider</p>
                  <p className="font-medium capitalize">{selected.provider}</p>
                </div>
                <div>
                  <p className="text-muted-foreground">Event</p>
                  <p>{selected.eventType ?? "—"}</p>
                </div>
                <div>
                  <p className="text-muted-foreground">Received</p>
                  <p>{format(selected.createdAt, "MMM d, yyyy HH:mm:ss")}</p>
                </div>
                <div>
                  <p className="text-muted-foreground">Processed</p>
                  <p>{selected.processedAt ? format(selected.processedAt, "MMM d, yyyy HH:mm:ss") : "—"}</p>
                </div>
              </div>
              {selected.idempotencyKey && (
                <div>
                  <p className="text-muted-foreground">Idempotency key</p>
                  <p className="font-mono text-xs break-all">{selected.idempotencyKey}</p>
                </div>
              )}
              {selected.processingError && (
                <div className="p-3 rounded-lg bg-destructive/10 text-destructive text-sm">
                  {selected.processingError}
                </div>
              )}
              <div>
                <p className="text-muted-foreground mb-2">Payload</p>
                <pre className="text-xs bg-muted p-4 rounded-lg overflow-x-auto max-h-80">
                  {JSON.stringify(selected.payload, null, 2)}
                </pre>
              </div>
            </div>
          ) : null}
        </DialogContent>
      </Dialog>
    </div>
  );
};
