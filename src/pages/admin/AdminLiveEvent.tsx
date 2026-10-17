import { useEffect, useState } from "react";
import { Link, useParams } from "react-router-dom";
import { formatDistanceToNow } from "date-fns";
import { ArrowLeft, Copy, ExternalLink, FastForward, Loader2, StopCircle, UserMinus } from "lucide-react";
import { toast } from "sonner";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { Label } from "@/components/ui/label";
import { Textarea } from "@/components/ui/textarea";
import { Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { useAdminLiveEvent, useAdminMutations } from "@/hooks/admin/useAdminQueries";
import { useAdminAuth } from "@/hooks/useAdminAuth";
import { floorChargedSoFar } from "@/lib/adminMappers";
import { can } from "@/types/admin";

const SLOTS = 8;

const naira = (n: number) =>
  new Intl.NumberFormat("en-NG", { style: "currency", currency: "NGN", minimumFractionDigits: 0 }).format(n);

const countdown = (endsAt: Date | undefined, now: number) => {
  if (!endsAt) return "—";
  const s = Math.max(0, Math.round((endsAt.getTime() - now) / 1000));
  return `${Math.floor(s / 60)}:${String(s % 60).padStart(2, "0")}`;
};

function RemoveDialog({
  eventId,
  target,
  onClose,
}: {
  eventId: string;
  target: { holdId: string; name: string; onFloor: boolean };
  onClose: () => void;
}) {
  const { removeFloorHold } = useAdminMutations();
  const [reason, setReason] = useState("");
  const [saving, setSaving] = useState(false);

  const submit = async () => {
    setSaving(true);
    try {
      const res = (await removeFloorHold(eventId, target.holdId, reason.trim())) as { charged_kobo?: number } | undefined;
      const charged = Number(res?.charged_kobo ?? 0) / 100;
      toast.success(charged > 0 ? `Removed — charged ${naira(charged)}` : "Removed — no charge");
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
          <DialogTitle>Remove {target.name || "this person"} from the {target.onFloor ? "dance floor" : "queue"}</DialogTitle>
          <DialogDescription>
            {target.onFloor
              ? "They're charged only for the time they danced; the host keeps that. The next person steps up."
              : "They're released with no charge."}
          </DialogDescription>
        </DialogHeader>
        <div className="space-y-2 py-2">
          <Label>Reason (the person will see this)</Label>
          <Textarea value={reason} onChange={(e) => setReason(e.target.value)} />
        </div>
        <DialogFooter>
          <Button variant="outline" onClick={onClose}>Cancel</Button>
          <Button variant="destructive" disabled={!reason.trim() || saving} onClick={submit}>
            {saving && <Loader2 className="w-4 h-4 mr-2 animate-spin" />}
            Remove
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}

export const AdminLiveEvent = () => {
  const { id } = useParams();
  const { session } = useAdminAuth();
  const role = session?.role;
  const { data, isLoading, isError, refetch } = useAdminLiveEvent(id ?? null);
  const { advanceFloor, endEvent } = useAdminMutations();
  const [removing, setRemoving] = useState<{ holdId: string; name: string; onFloor: boolean } | null>(null);
  const [busy, setBusy] = useState(false);
  const [now, setNow] = useState(Date.now());

  // Ticks the floor countdowns between the 5-second refreshes.
  useEffect(() => {
    const t = setInterval(() => setNow(Date.now()), 1000);
    return () => clearInterval(t);
  }, []);

  if (!can(role, "events.view")) {
    return <div className="p-8 text-muted-foreground">Your admin role can't view events.</div>;
  }
  if (isError && !data) {
    return (
      <div className="p-8 space-y-3 text-muted-foreground">
        <p>Couldn't load this event.</p>
        <Button variant="outline" onClick={() => void refetch()}>Try again</Button>
      </div>
    );
  }
  if (isLoading || !data) {
    return (
      <div className="p-8 flex items-center text-muted-foreground">
        <Loader2 className="w-5 h-5 animate-spin mr-2" />
        Loading event…
      </div>
    );
  }

  const { event, host, totals, floor, queue, holds } = data;
  const live = event.status === "live";
  const canEnd = can(role, "events.end");
  const canRemove = can(role, "events.floor");
  const appUrl = String(import.meta.env.VITE_NEW_APP_URL ?? "").trim().replace(/\/$/, "");
  const projector = appUrl ? `${appUrl}/screen/${event.code}` : "";
  const bySlot = new Map(floor.map((f) => [f.slot, f]));

  const advance = async () => {
    setBusy(true);
    try {
      const res = (await advanceFloor(event.id)) as { on_floor?: number; queued?: number } | undefined;
      toast.success(`Floor advanced — ${res?.on_floor ?? 0} dancing, ${res?.queued ?? 0} waiting`);
    } catch (err) {
      toast.error(err instanceof Error ? err.message : "That didn't work");
    } finally {
      setBusy(false);
    }
  };

  const end = async () => {
    if (!window.confirm("End this event now? The floor and queue are settled and nobody can spray any more.")) return;
    setBusy(true);
    try {
      await endEvent(event.id);
      toast.success("Event ended");
    } catch (err) {
      toast.error(err instanceof Error ? err.message : "That didn't work");
    } finally {
      setBusy(false);
    }
  };

  return (
    <div className="p-8 space-y-6">
      <Link to="/admin/events" className="text-sm text-muted-foreground inline-flex items-center gap-1 hover:underline">
        <ArrowLeft className="w-4 h-4" /> Events
      </Link>

      <div className="flex flex-wrap items-start justify-between gap-4">
        <div>
          <div className="flex items-center gap-2">
            <h1 className="text-3xl font-bold text-foreground">{event.title}</h1>
            {live ? (
              <Badge className="bg-success/20 text-success border-0 gap-1">
                <span className="w-2 h-2 rounded-full bg-success animate-pulse" />Live
              </Badge>
            ) : (
              <Badge variant="outline" className="capitalize">{event.status}</Badge>
            )}
            {event.flagged && <Badge variant="destructive">Flagged</Badge>}
          </div>
          <p className="text-muted-foreground mt-1">
            <span className="font-mono">{event.code}</span>
            {host && <> · Host <Link to={`/admin/users/${host.id}`} className="hover:underline">{host.name || host.email || host.id}</Link></>}
          </p>
          <p className="text-sm text-muted-foreground mt-1">
            {event.participants} participants · {naira(event.totalSprayed)} sprayed · {naira(totals.held)} held right now
            {event.startedAt && live && ` · live ${formatDistanceToNow(event.startedAt, { addSuffix: true })}`}
          </p>
          <div className="mt-2 text-sm">
            {projector ? (
              <span className="inline-flex gap-2">
                <a href={projector} target="_blank" rel="noopener noreferrer" className="inline-flex items-center gap-1 hover:underline">
                  <ExternalLink className="w-4 h-4" /> Open projector
                </a>
                <button
                  type="button"
                  className="inline-flex items-center gap-1 hover:underline"
                  onClick={() => {
                    void navigator.clipboard.writeText(projector).then(() => toast.success("Projector link copied"));
                  }}
                >
                  <Copy className="w-4 h-4" /> Copy link
                </button>
              </span>
            ) : (
              <span className="text-muted-foreground">
                Projector: <span className="font-mono">/screen/{event.code}</span> on the new app (set VITE_NEW_APP_URL to link it)
              </span>
            )}
          </div>
        </div>
        {live && canEnd && (
          <div className="flex gap-2">
            <Button variant="outline" onClick={advance} disabled={busy}>
              <FastForward className="w-4 h-4 mr-2" />Advance floor now
            </Button>
            <Button variant="destructive" onClick={end} disabled={busy}>
              <StopCircle className="w-4 h-4 mr-2" />End event
            </Button>
          </div>
        )}
      </div>

      <Card className="bg-card border-border">
        <CardHeader>
          <CardTitle className="text-lg">Dance floor ({floor.length} of {SLOTS})</CardTitle>
        </CardHeader>
        <CardContent className="grid gap-3 sm:grid-cols-2 lg:grid-cols-4">
          {Array.from({ length: SLOTS }, (_, i) => i + 1).map((slot) => {
            const f = bySlot.get(slot);
            return (
              <div key={slot} className="rounded-lg border border-border p-3 text-sm min-h-[92px]">
                <p className="text-xs text-muted-foreground">Slot {slot}</p>
                {f ? (
                  <>
                    <Link to={`/admin/users/${f.sprayerId}`} className="font-medium hover:underline">{f.name || f.sprayerId}</Link>
                    <p>{naira(f.held)} held · {countdown(f.endsAt, now)} left</p>
                    <p className="text-muted-foreground">
                      Charged so far {naira(floorChargedSoFar(f.noteCount, f.denomination, f.seconds, f.startedAt, now))}
                    </p>
                    {canRemove && live && (
                      <Button variant="ghost" size="sm" className="mt-1 px-2 text-destructive"
                        onClick={() => setRemoving({ holdId: f.id, name: f.name, onFloor: true })}>
                        <UserMinus className="w-4 h-4 mr-1" />Remove
                      </Button>
                    )}
                  </>
                ) : (
                  <p className="text-muted-foreground">Empty</p>
                )}
              </div>
            );
          })}
        </CardContent>
      </Card>

      <Card className="bg-card border-border">
        <CardHeader>
          <CardTitle className="text-lg">Queue ({queue.length})</CardTitle>
        </CardHeader>
        <CardContent className="text-sm">
          {queue.length === 0 ? (
            <p className="text-muted-foreground">Nobody waiting.</p>
          ) : (
            queue.map((q) => (
              <div key={q.id} className="flex items-center justify-between py-1.5 border-b border-border last:border-0">
                <span>
                  <span className="text-muted-foreground mr-2">#{q.position}</span>
                  <Link to={`/admin/users/${q.sprayerId}`} className="hover:underline">{q.name || q.sprayerId}</Link>
                  {" · "}{naira(q.held)} held
                  {q.queuedAt && <span className="text-muted-foreground"> · waiting {formatDistanceToNow(q.queuedAt)}</span>}
                </span>
                {canRemove && live && (
                  <Button variant="ghost" size="sm" className="text-destructive"
                    onClick={() => setRemoving({ holdId: q.id, name: q.name, onFloor: false })}>
                    <UserMinus className="w-4 h-4 mr-1" />Remove
                  </Button>
                )}
              </div>
            ))
          )}
        </CardContent>
      </Card>

      <Card className="bg-card border-border">
        <CardHeader>
          <CardTitle className="text-lg">Other active sprays ({holds.length})</CardTitle>
        </CardHeader>
        <CardContent className="text-sm">
          {holds.length === 0 ? (
            <p className="text-muted-foreground">None.</p>
          ) : (
            holds.map((p) => (
              <div key={p.id} className="flex justify-between py-1.5 border-b border-border last:border-0">
                <Link to={`/admin/users/${p.sprayerId}`} className="hover:underline">{p.name || p.sprayerId}</Link>
                <span>
                  {naira(p.held)}
                  {p.expiresAt && <span className="text-muted-foreground"> · expires {formatDistanceToNow(p.expiresAt, { addSuffix: true })}</span>}
                </span>
              </div>
            ))
          )}
        </CardContent>
      </Card>

      {removing && <RemoveDialog eventId={event.id} target={removing} onClose={() => setRemoving(null)} />}
    </div>
  );
};
