import { useCallback, useEffect, useMemo, useState } from "react";
import { format } from "date-fns";
import { toast } from "sonner";
import { Button } from "@/components/ui/button";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import { admin as adminApi } from "@/lib/supabase";
import { useAdminAuth } from "@/hooks/useAdminAuth";
import { can } from "@/types/admin";

type AuditRow = {
  id: string;
  admin_user_id: string;
  admin_email: string;
  action: string;
  target_type: string;
  target_id: string | null;
  details: Record<string, unknown> | null;
  created_at: string;
};

type TeamRow = { user_id: string; email: string };

const PAGE_SIZE = 50;

// Actions the admin API and admin database functions record (All shows every entry).
const ACTIONS = [
  "suspend_user", "unsuspend_user", "ban_user", "unban_user",
  "flag_transaction", "unflag_transaction", "reprocess_webhook", "probe_all_providers",
  "flag_event", "unflag_event", "end_event",
  "invite_admin", "accept_admin_invite", "enable_admin", "disable_admin", "change_admin_role",
  "refund_transaction", "set_wallet_funding_provider", "set_psp_env", "set_withdrawal_fee_settings",
  "set_fx_settings", "set_fx_market_rate_manual", "record_treasury_topup",
  "ad_created", "ad_updated", "floor_avatar_removed",
];

export const AdminAuditLog = () => {
  const { session } = useAdminAuth();
  const [rows, setRows] = useState<AuditRow[]>([]);
  const [total, setTotal] = useState(0);
  const [page, setPage] = useState(1);
  const [action, setAction] = useState("all");
  const [adminId, setAdminId] = useState("all");
  const [team, setTeam] = useState<TeamRow[]>([]);
  const [loading, setLoading] = useState(true);

  const load = useCallback(async () => {
    setLoading(true);
    try {
      const res = (await adminApi.audit({
        page,
        limit: PAGE_SIZE,
        action: action === "all" ? undefined : action,
        admin_id: adminId === "all" ? undefined : adminId,
      })) as { logs?: AuditRow[]; total?: number };
      setRows(res.logs ?? []);
      setTotal(res.total ?? 0);
    } catch (err) {
      toast.error(err instanceof Error ? err.message : "Couldn't load the audit log");
    } finally {
      setLoading(false);
    }
  }, [page, action, adminId]);

  useEffect(() => {
    void load();
  }, [load]);

  useEffect(() => {
    adminApi.team.list()
      .then((res) => setTeam(((res as { team?: TeamRow[] }).team ?? []).filter((m) => m.email)))
      .catch(() => setTeam([]));
  }, []);

  const pages = useMemo(() => Math.max(1, Math.ceil(total / PAGE_SIZE)), [total]);

  if (!can(session?.role, "*")) {
    return <div className="p-8 text-muted-foreground">Only super admins can see the audit log.</div>;
  }

  return (
    <div className="p-8 space-y-6">
      <div>
        <h1 className="text-3xl font-bold text-foreground">Audit Log</h1>
        <p className="text-muted-foreground mt-1">Every admin action, newest first</p>
      </div>

      <div className="flex flex-wrap gap-3">
        <Select value={action} onValueChange={(v) => { setAction(v); setPage(1); }}>
          <SelectTrigger className="w-[220px]"><SelectValue placeholder="Action" /></SelectTrigger>
          <SelectContent>
            <SelectItem value="all">All actions</SelectItem>
            {ACTIONS.map((a) => <SelectItem key={a} value={a}>{a.replace(/_/g, " ")}</SelectItem>)}
          </SelectContent>
        </Select>
        <Select value={adminId} onValueChange={(v) => { setAdminId(v); setPage(1); }}>
          <SelectTrigger className="w-[260px]"><SelectValue placeholder="Admin" /></SelectTrigger>
          <SelectContent>
            <SelectItem value="all">All admins</SelectItem>
            {team.map((m) => <SelectItem key={m.user_id} value={m.user_id}>{m.email}</SelectItem>)}
          </SelectContent>
        </Select>
      </div>

      <div className="bg-card rounded-xl border border-border overflow-hidden">
        <Table>
          <TableHeader>
            <TableRow className="border-border hover:bg-transparent">
              <TableHead className="text-muted-foreground">Time</TableHead>
              <TableHead className="text-muted-foreground">Admin</TableHead>
              <TableHead className="text-muted-foreground">Action</TableHead>
              <TableHead className="text-muted-foreground">Target</TableHead>
              <TableHead className="text-muted-foreground">Details</TableHead>
            </TableRow>
          </TableHeader>
          <TableBody>
            {loading ? (
              <TableRow><TableCell colSpan={5} className="text-center py-8 text-muted-foreground">Loading…</TableCell></TableRow>
            ) : rows.length === 0 ? (
              <TableRow><TableCell colSpan={5} className="text-center py-8 text-muted-foreground">No entries</TableCell></TableRow>
            ) : (
              rows.map((r) => (
                <TableRow key={r.id} className="border-border align-top">
                  <TableCell className="whitespace-nowrap text-sm">{format(new Date(r.created_at), "MMM d, yyyy HH:mm")}</TableCell>
                  <TableCell className="text-sm">{r.admin_email || r.admin_user_id}</TableCell>
                  <TableCell className="text-sm font-medium">{r.action.replace(/_/g, " ")}</TableCell>
                  <TableCell className="text-xs text-muted-foreground">
                    {r.target_type}
                    {r.target_id && <span className="block font-mono">{r.target_id}</span>}
                  </TableCell>
                  <TableCell>
                    {r.details && (
                      <pre className="text-xs text-muted-foreground whitespace-pre-wrap break-all max-w-md">
                        {JSON.stringify(r.details, null, 2)}
                      </pre>
                    )}
                  </TableCell>
                </TableRow>
              ))
            )}
          </TableBody>
        </Table>
      </div>

      <div className="flex items-center justify-between">
        <p className="text-sm text-muted-foreground">{total} entries · page {page} of {pages}</p>
        <div className="flex gap-2">
          <Button variant="outline" size="sm" disabled={page <= 1 || loading} onClick={() => setPage((p) => p - 1)}>Previous</Button>
          <Button variant="outline" size="sm" disabled={page >= pages || loading} onClick={() => setPage((p) => p + 1)}>Next</Button>
        </div>
      </div>
    </div>
  );
};
