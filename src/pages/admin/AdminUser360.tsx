import { useState } from "react";
import { Link, useParams } from "react-router-dom";
import { format, formatDistanceToNow } from "date-fns";
import { ArrowLeft, Ban, Loader2, RotateCcw, ShieldOff, UserCheck, UserX } from "lucide-react";
import { toast } from "sonner";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Textarea } from "@/components/ui/textarea";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import { Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { useAdminMutations, useAdminUser360 } from "@/hooks/admin/useAdminQueries";
import { useAdminAuth } from "@/hooks/useAdminAuth";
import { can } from "@/types/admin";
import type { AdminUser360 as User360 } from "@/types/admin";

const formatAmount = (amount: number, currency: string) =>
  currency === "USDC"
    ? new Intl.NumberFormat("en-US", { style: "currency", currency: "USD", minimumFractionDigits: 2 }).format(amount)
    : new Intl.NumberFormat("en-NG", { style: "currency", currency: "NGN", minimumFractionDigits: 0 }).format(amount);

const label = (s: string) => s.replace(/_/g, " ");

const statusBadge = (status: string) => {
  const cls: Record<string, string> = {
    active: "bg-success/20 text-success border-0",
    verified: "bg-success/20 text-success border-0",
    completed: "bg-success/20 text-success border-0",
    suspended: "bg-accent/20 text-accent border-0",
    pending: "bg-primary/20 text-primary border-0",
    processing: "bg-primary/20 text-primary border-0",
  };
  if (status === "banned" || status === "rejected" || status === "failed") {
    return <Badge variant="destructive" className="capitalize">{label(status)}</Badge>;
  }
  return <Badge className={`capitalize ${cls[status] ?? ""}`} variant={cls[status] ? undefined : "outline"}>{label(status)}</Badge>;
};

const runToast = async (fn: () => Promise<unknown>, success: string) => {
  try {
    await fn();
    toast.success(success);
    return true;
  } catch (err) {
    toast.error(err instanceof Error ? err.message : "That didn't work");
    return false;
  }
};

function ReasonDialog({
  title,
  description,
  confirmLabel,
  destructive,
  confirmText,
  reasonLabel,
  onSubmit,
  onClose,
}: {
  title: string;
  description: string;
  confirmLabel: string;
  destructive?: boolean;
  /** When set, the admin must type this (any case) to enable the button. */
  confirmText?: string;
  reasonLabel: string;
  onSubmit: (reason: string, confirm: string) => Promise<boolean>;
  onClose: () => void;
}) {
  const [reason, setReason] = useState("");
  const [confirm, setConfirm] = useState("");
  const [saving, setSaving] = useState(false);
  const confirmed = confirmText === undefined || confirm.trim().toLowerCase() === confirmText.trim().toLowerCase();
  const ready = reason.trim() !== "" && confirmed;

  return (
    <Dialog open onOpenChange={(open) => !open && onClose()}>
      <DialogContent>
        <DialogHeader>
          <DialogTitle>{title}</DialogTitle>
          <DialogDescription>{description}</DialogDescription>
        </DialogHeader>
        <div className="space-y-4 py-2">
          <div className="space-y-2">
            <Label>{reasonLabel}</Label>
            <Textarea value={reason} onChange={(e) => setReason(e.target.value)} />
          </div>
          {confirmText !== undefined && (
            <div className="space-y-2">
              <Label>Type <span className="font-medium">{confirmText}</span> to confirm</Label>
              <Input value={confirm} onChange={(e) => setConfirm(e.target.value)} />
            </div>
          )}
        </div>
        <DialogFooter>
          <Button variant="outline" onClick={onClose}>Cancel</Button>
          <Button
            variant={destructive ? "destructive" : "default"}
            disabled={!ready || saving}
            onClick={async () => {
              setSaving(true);
              const ok = await onSubmit(reason.trim(), confirm.trim());
              setSaving(false);
              if (ok) onClose();
            }}
          >
            {saving && <Loader2 className="w-4 h-4 mr-2 animate-spin" />}
            {confirmLabel}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}

function KycCard({ data }: { data: User360 }) {
  const { revokeKyc, resetKycAttempts } = useAdminMutations();
  const [revoking, setRevoking] = useState<string | null>(null);
  const [resetting, setResetting] = useState(false);
  const kyc = data.kyc!;
  const who = data.user.name.trim() || data.user.email || "";

  const reset = async () => {
    if (!window.confirm("Let this person try verifying again now?")) return;
    setResetting(true);
    await runToast(() => resetKycAttempts(data.user.id), "Attempts reset");
    setResetting(false);
  };

  return (
    <Card className="bg-card border-border">
      <CardHeader>
        <CardTitle className="text-lg">Identity verification</CardTitle>
      </CardHeader>
      <CardContent className="space-y-4">
        <div className="flex items-center justify-between text-sm">
          <p>
            Attempts in the last 24 h: <span className="font-medium">{kyc.attempts24h} of {kyc.attemptsMax}</span>
          </p>
          {kyc.attempts24h > 0 && (
            <Button variant="outline" size="sm" onClick={reset} disabled={resetting}>
              <RotateCcw className="w-4 h-4 mr-2" />
              Reset attempts
            </Button>
          )}
        </div>
        {kyc.records.length === 0 ? (
          <p className="text-sm text-muted-foreground">No verification records.</p>
        ) : (
          <Table>
            <TableHeader>
              <TableRow className="border-border hover:bg-transparent">
                <TableHead>Level</TableHead>
                <TableHead>Status</TableHead>
                <TableHead>Method</TableHead>
                <TableHead>BVN</TableHead>
                <TableHead>Scores</TableHead>
                <TableHead>Reason</TableHead>
                <TableHead>Date</TableHead>
                <TableHead />
              </TableRow>
            </TableHeader>
            <TableBody>
              {kyc.records.map((r) => (
                <TableRow key={r.id} className="border-border">
                  <TableCell>{r.level}</TableCell>
                  <TableCell>
                    <div className="flex items-center gap-1">
                      {statusBadge(r.status)}
                      {r.superseded && <Badge variant="outline" className="text-muted-foreground">superseded</Badge>}
                    </div>
                  </TableCell>
                  <TableCell className="text-sm">{r.method ? label(r.method) : "—"}</TableCell>
                  <TableCell className="font-mono text-xs">{r.bvnLastFour ? `••••${r.bvnLastFour}` : "—"}</TableCell>
                  <TableCell className="text-xs text-muted-foreground">
                    {r.matchScore != null && <span className="block">Match {r.matchScore}</span>}
                    {r.livenessScore != null && <span className="block">Liveness {r.livenessScore}</span>}
                  </TableCell>
                  <TableCell className="text-sm text-muted-foreground max-w-xs">{r.rejectionReason ?? "—"}</TableCell>
                  <TableCell className="text-xs whitespace-nowrap">{format(r.verifiedAt ?? r.submittedAt, "MMM d, yyyy")}</TableCell>
                  <TableCell>
                    {r.status === "verified" && !r.superseded && !who && (
                      <span className="text-xs text-muted-foreground">No name or email to confirm with</span>
                    )}
                    {r.status === "verified" && !r.superseded && who && (
                      <Button variant="destructive" size="sm" onClick={() => setRevoking(r.id)}>
                        <ShieldOff className="w-4 h-4 mr-1" />
                        Revoke
                      </Button>
                    )}
                  </TableCell>
                </TableRow>
              ))}
            </TableBody>
          </Table>
        )}
      </CardContent>
      {revoking && (
        <ReasonDialog
          title="Revoke verification"
          description="The person drops to Level 1 (unless another verified record remains) and gets a notification with your reason. Selling and cash-outs need Level 2 again."
          reasonLabel="Reason (the person will see this)"
          confirmLabel="Revoke"
          destructive
          confirmText={who}
          onClose={() => setRevoking(null)}
          onSubmit={async (reason, confirm) => {
            try {
              const res = (await revokeKyc(revoking, reason, confirm)) as { kyc_level?: number } | undefined;
              toast.success(`Verification revoked — now at Level ${res?.kyc_level ?? "?"}`);
              return true;
            } catch (err) {
              toast.error(err instanceof Error ? err.message : "That didn't work");
              return false;
            }
          }}
        />
      )}
    </Card>
  );
}

function MoneyCard({ money }: { money: NonNullable<User360["money"]> }) {
  return (
    <Card className="bg-card border-border">
      <CardHeader>
        <CardTitle className="text-lg">Money</CardTitle>
      </CardHeader>
      <CardContent className="space-y-5 text-sm">
        <div className="flex flex-wrap gap-6">
          {money.wallets.map((w) => (
            <div key={w.currency}>
              <p className="text-muted-foreground">{w.currency} Bag</p>
              <p className="text-xl font-bold">{formatAmount(w.balance - w.held, w.currency)}</p>
              {w.held > 0 && <p className="text-xs text-muted-foreground">{formatAmount(w.held, w.currency)} held</p>}
            </div>
          ))}
        </div>

        {money.openPayouts.length > 0 && (
          <div>
            <p className="font-medium mb-1">Open payouts</p>
            {money.openPayouts.map((p) => (
              <Link key={p.id} to={`/admin/payouts?open=${p.id}`} className="flex justify-between py-1 border-b border-border last:border-0 hover:underline">
                <span>{formatAmount(p.amount, p.currency)} · {label(p.status)} {p.needsReview && <Badge variant="destructive" className="ml-1">Review</Badge>}</span>
                <span className="text-xs text-muted-foreground">{formatDistanceToNow(p.createdAt, { addSuffix: true })}</span>
              </Link>
            ))}
          </div>
        )}

        <div>
          <p className="font-medium mb-1">Recent transactions</p>
          {money.transactions.length === 0 ? (
            <p className="text-muted-foreground">None.</p>
          ) : (
            money.transactions.map((t) => (
              <Link key={t.id} to={`/admin/transactions/${t.id}`} className="flex justify-between py-1 border-b border-border last:border-0 hover:underline">
                <span className="capitalize">{label(t.type)} · {formatAmount(t.amount, t.currency)} · {label(t.status)}</span>
                <span className="text-xs text-muted-foreground">{format(t.createdAt, "MMM d, HH:mm")}</span>
              </Link>
            ))
          )}
        </div>

        {money.bundleOrders.length > 0 && (
          <div>
            <p className="font-medium mb-1">Bundle orders</p>
            {money.bundleOrders.map((o) => (
              <Link key={o.id} to={`/admin/bundle-orders?open=${o.id}`} className="flex justify-between py-1 border-b border-border last:border-0 hover:underline">
                <span>{o.bundles} bundles · {formatAmount(o.amount, o.currency)} · {label(o.status)}{o.refunded ? " · refunded" : ""}</span>
                <span className="text-xs text-muted-foreground">{format(o.createdAt, "MMM d")}</span>
              </Link>
            ))}
          </div>
        )}

        <div>
          <p className="font-medium mb-1">Bank accounts</p>
          {money.bankAccounts.length === 0 ? (
            <p className="text-muted-foreground">None saved.</p>
          ) : (
            money.bankAccounts.map((b) => (
              <p key={b.id} className="py-1">
                {b.bankName} · {b.accountName} · <span className="font-mono">{b.accountNumber}</span>
                {b.isDefault && <Badge variant="outline" className="ml-2">default</Badge>}
              </p>
            ))
          )}
        </div>
      </CardContent>
    </Card>
  );
}

export const AdminUser360 = () => {
  const { id } = useParams();
  const { session } = useAdminAuth();
  const { data, isLoading, isError, refetch } = useAdminUser360(id ?? null);
  const { suspendUser, unsuspendUser, banUser, unbanUser } = useAdminMutations();
  const [dialog, setDialog] = useState<"suspend" | "ban" | null>(null);

  // The query never runs for a role without users.view (e.g. finance), so say so instead of spinning.
  if (!can(session?.role, "users.view")) {
    return <div className="p-8 text-muted-foreground">Your admin role can't view user profiles.</div>;
  }

  if (isError && !data) {
    return (
      <div className="p-8 space-y-3 text-muted-foreground">
        <p>Couldn't load this user.</p>
        <Button variant="outline" onClick={() => void refetch()}>Try again</Button>
      </div>
    );
  }
  if (isLoading || !data) {
    return (
      <div className="p-8 flex items-center text-muted-foreground">
        <Loader2 className="w-5 h-5 animate-spin mr-2" />
        Loading user…
      </div>
    );
  }

  const u = data.user;
  const display = u.name || u.email || u.id;

  return (
    <div className="p-8 space-y-6">
      <Link to="/admin/users" className="text-sm text-muted-foreground inline-flex items-center gap-1 hover:underline">
        <ArrowLeft className="w-4 h-4" /> Users
      </Link>

      <div className="flex flex-wrap items-start justify-between gap-4">
        <div>
          <div className="flex items-center gap-2">
            <h1 className="text-3xl font-bold text-foreground">{display}</h1>
            {statusBadge(u.status)}
            <Badge variant="outline">KYC level {u.kycLevel}</Badge>
          </div>
          <p className="text-muted-foreground mt-1">
            {[u.username && `@${u.username}`, u.email, u.phone].filter(Boolean).join(" · ")}
          </p>
          <p className="text-xs text-muted-foreground mt-1">
            Joined {format(u.createdAt, "MMM d, yyyy")}
            {u.lastActive && ` · active ${formatDistanceToNow(u.lastActive, { addSuffix: true })}`}
          </p>
          {u.status !== "active" && u.suspendedReason && (
            <p className="text-sm text-muted-foreground mt-2">Reason: {u.suspendedReason}</p>
          )}
        </div>
        {data.can.actions && (
          <div className="flex gap-2">
            {u.status === "active" && (
              <>
                <Button variant="outline" onClick={() => setDialog("suspend")}><UserX className="w-4 h-4 mr-2" />Suspend</Button>
                <Button variant="destructive" onClick={() => setDialog("ban")}><Ban className="w-4 h-4 mr-2" />Ban</Button>
              </>
            )}
            {u.status === "suspended" && (
              <Button onClick={() => void runToast(() => unsuspendUser(u.id), "Unsuspended")}><UserCheck className="w-4 h-4 mr-2" />Unsuspend</Button>
            )}
            {u.status === "banned" && (
              <Button onClick={() => void runToast(() => unbanUser(u.id), "Unbanned")}><UserCheck className="w-4 h-4 mr-2" />Unban</Button>
            )}
          </div>
        )}
      </div>

      <div className="grid gap-6 lg:grid-cols-2">
        {data.kyc && <div className="lg:col-span-2"><KycCard data={data} /></div>}
        {data.money && <MoneyCard money={data.money} />}

        {data.security && (
          <Card className="bg-card border-border">
            <CardHeader>
              <CardTitle className="text-lg">Security</CardTitle>
            </CardHeader>
            <CardContent className="space-y-1 text-sm">
              <p>Transaction PIN: {data.security.pinSet ? "set" : "not set"}</p>
              <p>Failed PIN attempts: {data.security.pinFailedAttempts}</p>
              {data.security.pinLockedUntil && data.security.pinLockedUntil > new Date() && (
                <p className="text-destructive">Locked until {format(data.security.pinLockedUntil, "MMM d, HH:mm")}</p>
              )}
            </CardContent>
          </Card>
        )}

        {data.activity && (
          <Card className="bg-card border-border">
            <CardHeader>
              <CardTitle className="text-lg">Activity</CardTitle>
            </CardHeader>
            <CardContent className="space-y-2 text-sm">
              <p>Giveaways created: {data.activity.giveawaysCreated}</p>
              <p className="font-medium">Events hosted</p>
              {data.activity.eventsHosted.length === 0 ? (
                <p className="text-muted-foreground">None.</p>
              ) : (
                data.activity.eventsHosted.map((e) => (
                  <Link key={e.id} to="/admin/events" className="flex justify-between py-1 border-b border-border last:border-0 hover:underline">
                    <span>{e.title} · <span className="font-mono text-xs">{e.code}</span></span>
                    {statusBadge(e.status)}
                  </Link>
                ))
              )}
            </CardContent>
          </Card>
        )}
      </div>

      {dialog && (
        <ReasonDialog
          title={dialog === "suspend" ? "Suspend user" : "Ban user"}
          description={dialog === "suspend"
            ? "They can still sign in and read, but can't move money or host."
            : "They can't sign in, move money or host until unbanned."}
          reasonLabel="Reason"
          confirmLabel={dialog === "suspend" ? "Suspend" : "Ban"}
          destructive={dialog === "ban"}
          onClose={() => setDialog(null)}
          onSubmit={(reason) =>
            runToast(
              () => (dialog === "suspend" ? suspendUser(u.id, reason) : banUser(u.id, reason)),
              dialog === "suspend" ? "Suspended" : "Banned",
            )}
        />
      )}
    </div>
  );
};
