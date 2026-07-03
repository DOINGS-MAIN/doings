import { useEffect, useState } from "react";
import { Link } from "react-router-dom";
import { format, formatDistanceToNow } from "date-fns";
import { Activity, Download, Loader2, RefreshCw, Search } from "lucide-react";
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
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from "@/components/ui/table";
import { admin as adminApi } from "@/lib/supabase";
import { useAdminMonitoring } from "@/hooks/useAdminMonitoring";
import { toast } from "sonner";
import type { PspEventRecord } from "@/types/admin";

export const AdminPspEvents = () => {
  const { fetchPspEvents } = useAdminMonitoring();
  const [events, setEvents] = useState<PspEventRecord[]>([]);
  const [total, setTotal] = useState(0);
  const [page, setPage] = useState(1);
  const [loading, setLoading] = useState(true);
  const [search, setSearch] = useState("");
  const [debouncedSearch, setDebouncedSearch] = useState("");
  const [providerFilter, setProviderFilter] = useState("all");
  const [directionFilter, setDirectionFilter] = useState("all");

  useEffect(() => {
    const t = setTimeout(() => setDebouncedSearch(search), 300);
    return () => clearTimeout(t);
  }, [search]);

  useEffect(() => {
    setPage(1);
  }, [debouncedSearch, providerFilter, directionFilter]);

  const load = async () => {
    setLoading(true);
    try {
      const res = await fetchPspEvents({
        page,
        limit: 50,
        provider: providerFilter !== "all" ? providerFilter : undefined,
        direction: directionFilter !== "all" ? directionFilter : undefined,
        search: debouncedSearch || undefined,
      });
      setEvents(res.events);
      setTotal(res.total);
    } catch (err) {
      toast.error(err instanceof Error ? err.message : "Failed to load PSP events");
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => {
    load();
  }, [page, debouncedSearch, providerFilter, directionFilter]);

  const totalPages = Math.max(1, Math.ceil(total / 50));

  const handleExport = async () => {
    await adminApi.pspEvents.exportCsv({
      ...(providerFilter !== "all" ? { provider: providerFilter } : {}),
      ...(directionFilter !== "all" ? { direction: directionFilter } : {}),
      ...(debouncedSearch ? { search: debouncedSearch } : {}),
    });
  };

  return (
    <div className="p-8 space-y-6">
      <div className="flex items-start justify-between gap-4">
        <div>
          <h1 className="text-3xl font-bold text-foreground flex items-center gap-2">
            <Activity className="w-8 h-8" />
            PSP Activity
          </h1>
          <p className="text-muted-foreground mt-1">Outbound API calls, webhooks, and status polls</p>
        </div>
        <div className="flex gap-2">
          <Button variant="outline" onClick={handleExport}>
            <Download className="w-4 h-4 mr-2" />
            Export CSV
          </Button>
          <Button variant="outline" onClick={load} disabled={loading}>
            <RefreshCw className={`w-4 h-4 mr-2 ${loading ? "animate-spin" : ""}`} />
            Refresh
          </Button>
        </div>
      </div>

      <div className="flex flex-col sm:flex-row gap-4">
        <div className="relative flex-1">
          <Search className="absolute left-3 top-1/2 -translate-y-1/2 w-4 h-4 text-muted-foreground" />
          <Input
            placeholder="Search reference or event type..."
            value={search}
            onChange={(e) => setSearch(e.target.value)}
            className="pl-10"
          />
        </div>
        <Select value={providerFilter} onValueChange={setProviderFilter}>
          <SelectTrigger className="w-[140px]"><SelectValue placeholder="Provider" /></SelectTrigger>
          <SelectContent>
            <SelectItem value="all">All providers</SelectItem>
            <SelectItem value="monnify">Monnify</SelectItem>
            <SelectItem value="nomba">Nomba</SelectItem>
            <SelectItem value="flutterwave">Flutterwave</SelectItem>
          </SelectContent>
        </Select>
        <Select value={directionFilter} onValueChange={setDirectionFilter}>
          <SelectTrigger className="w-[140px]"><SelectValue placeholder="Direction" /></SelectTrigger>
          <SelectContent>
            <SelectItem value="all">All</SelectItem>
            <SelectItem value="inbound">Inbound</SelectItem>
            <SelectItem value="outbound">Outbound</SelectItem>
          </SelectContent>
        </Select>
      </div>

      <Card className="overflow-hidden">
        <CardContent className="p-0">
          <Table>
            <TableHeader>
              <TableRow>
                <TableHead>Time</TableHead>
                <TableHead>Provider</TableHead>
                <TableHead>Event</TableHead>
                <TableHead>Direction</TableHead>
                <TableHead>Status</TableHead>
                <TableHead>Reference</TableHead>
              </TableRow>
            </TableHeader>
            <TableBody>
              {loading ? (
                <TableRow>
                  <TableCell colSpan={6} className="text-center py-8 text-muted-foreground">
                    <Loader2 className="w-4 h-4 animate-spin inline mr-2" />
                    Loading…
                  </TableCell>
                </TableRow>
              ) : events.length === 0 ? (
                <TableRow>
                  <TableCell colSpan={6} className="text-center py-8 text-muted-foreground">
                    No PSP events found
                  </TableCell>
                </TableRow>
              ) : (
                events.map((event) => (
                  <TableRow key={event.id}>
                    <TableCell className="text-sm text-muted-foreground whitespace-nowrap">
                      <span title={format(event.createdAt, "PPpp")}>
                        {formatDistanceToNow(event.createdAt, { addSuffix: true })}
                      </span>
                    </TableCell>
                    <TableCell className="capitalize">{event.providerId}</TableCell>
                    <TableCell className="font-medium">{event.eventType}</TableCell>
                    <TableCell>
                      <Badge variant="outline" className="capitalize text-xs">{event.direction}</Badge>
                    </TableCell>
                    <TableCell className="text-xs font-mono">{event.providerStatus ?? event.status ?? "—"}</TableCell>
                    <TableCell className="font-mono text-xs max-w-[200px] truncate">
                      {event.transactionId ? (
                        <Link to={`/admin/transactions/${event.transactionId}`} className="text-primary hover:underline">
                          {event.reference ?? event.providerRef ?? event.transactionId.slice(0, 8)}
                        </Link>
                      ) : (
                        event.reference ?? event.providerRef ?? "—"
                      )}
                    </TableCell>
                  </TableRow>
                ))
              )}
            </TableBody>
          </Table>
        </CardContent>
      </Card>

      <div className="flex items-center justify-between">
        <p className="text-sm text-muted-foreground">{events.length} of {total} (page {page} of {totalPages})</p>
        <div className="flex gap-2">
          <Button variant="outline" size="sm" disabled={page <= 1} onClick={() => setPage((p) => p - 1)}>Previous</Button>
          <Button variant="outline" size="sm" disabled={page >= totalPages} onClick={() => setPage((p) => p + 1)}>Next</Button>
        </div>
      </div>
    </div>
  );
};
