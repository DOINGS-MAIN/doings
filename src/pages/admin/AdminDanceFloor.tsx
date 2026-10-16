import { useCallback, useEffect, useMemo, useState } from "react";
import { Navigate } from "react-router-dom";
import { Loader2, Music, Plus, Trash2, UserX } from "lucide-react";
import { toast } from "sonner";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { useAdminAuth } from "@/hooks/useAdminAuth";
import { admin as adminApi } from "@/lib/supabase";
import { ROLE_PERMISSIONS } from "@/types/admin";
import {
  DEFAULT_FLOOR_SETTINGS,
  floorSettingsError,
  floorTimeFor,
  parseFloorSettings,
  type FloorSettings,
} from "@/lib/danceFloorSettings";

const can = (role: string | undefined, permission: string) => {
  const permissions = ROLE_PERMISSIONS[role as keyof typeof ROLE_PERMISSIONS] ?? [];
  return permissions.includes("*") || permissions.includes(permission);
};

const SAMPLE_AMOUNTS = [1000, 5000, 20000, 50000, 200000, 1000000];
const naira = (n: number) => `₦${Math.trunc(n).toLocaleString("en-NG")}`;
const minutes = (s: number) => (s % 60 ? `${Math.floor(s / 60)} min ${s % 60}s` : `${s / 60} min`);

type FloorAvatar = {
  user_id: string;
  username: string | null;
  full_name: string | null;
  avatar_url: string | null;
  floor_version: number;
};

/** Dance floor (new app): floor-time bands and busy rule (finance), and floor avatar moderation (support). */
export const AdminDanceFloor = () => {
  const { currentAccount } = useAdminAuth();
  const role = currentAccount?.role;
  const canSettings = can(role, "payment_rails");
  const canModerate = can(role, "floor_avatars");

  if (!currentAccount || (!canSettings && !canModerate)) return <Navigate to="/admin" replace />;

  return (
    <div className="space-y-6 max-w-4xl">
      <div>
        <h1 className="text-2xl font-bold flex items-center gap-2">
          <Music className="h-6 w-6 text-primary" />
          Dance Floor
        </h1>
        <p className="text-muted-foreground mt-1">
          The new app's live floor: how long each spray dances, and guests' 3D avatars.
        </p>
      </div>
      {canSettings ? <FloorTimeSettings /> : null}
      {canModerate ? <FloorAvatarModeration /> : null}
    </div>
  );
};

function FloorTimeSettings() {
  const [saved, setSaved] = useState<FloorSettings | null>(null);
  const [draft, setDraft] = useState<FloorSettings>(DEFAULT_FLOOR_SETTINGS);
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [serverError, setServerError] = useState<string | null>(null);

  const load = useCallback(async () => {
    setLoading(true);
    const { data, error } = await adminApi.danceFloor.getSettings();
    const parsed = parseFloorSettings(error ? null : data);
    setSaved(parsed);
    setDraft(parsed);
    setLoading(false);
  }, []);

  useEffect(() => {
    void load();
  }, [load]);

  const problem = floorSettingsError(draft);
  const changed = JSON.stringify(draft) !== JSON.stringify(saved);

  const setBand = (i: number, key: "from_ngn" | "seconds", value: number) =>
    setDraft((d) => ({ ...d, bands: d.bands.map((b, j) => (j === i ? { ...b, [key]: value } : b)) }));

  async function save() {
    if (problem) return;
    setSaving(true);
    setServerError(null);
    const { error } = await adminApi.danceFloor.setSettings(draft);
    setSaving(false);
    if (error) {
      setServerError(error.message.replace(/^Invalid floor settings: /, ""));
      return;
    }
    toast.success("Dance floor settings saved");
    await load();
  }

  if (loading) {
    return (
      <div className="flex items-center justify-center min-h-[20vh]">
        <Loader2 className="h-8 w-8 animate-spin text-muted-foreground" />
      </div>
    );
  }

  return (
    <Card>
      <CardHeader>
        <CardTitle className="text-base">Floor time</CardTitle>
        <CardDescription>
          Each spray dances for the time of the band its amount falls in. Bands start at an amount (inclusive).
        </CardDescription>
      </CardHeader>
      <CardContent className="space-y-5">
        <div className="space-y-2">
          {draft.bands.map((b, i) => (
            <div key={i} className="flex items-end gap-3">
              <div className="flex-1">
                <Label htmlFor={`band-from-${i}`}>From (₦)</Label>
                <Input
                  id={`band-from-${i}`}
                  type="number"
                  min={0}
                  value={b.from_ngn}
                  disabled={i === 0}
                  onChange={(e) => setBand(i, "from_ngn", Number(e.target.value))}
                />
              </div>
              <div className="flex-1">
                <Label htmlFor={`band-sec-${i}`}>Floor time (seconds)</Label>
                <Input id={`band-sec-${i}`} type="number" min={15} max={900} value={b.seconds} onChange={(e) => setBand(i, "seconds", Number(e.target.value))} />
              </div>
              <Button
                type="button"
                variant="ghost"
                size="icon"
                aria-label={`Remove band ${i + 1}`}
                disabled={i === 0 || draft.bands.length <= 1}
                onClick={() => setDraft((d) => ({ ...d, bands: d.bands.filter((_, j) => j !== i) }))}
              >
                <Trash2 className="h-4 w-4" />
              </Button>
            </div>
          ))}
          <Button
            type="button"
            variant="outline"
            size="sm"
            disabled={draft.bands.length >= 6}
            onClick={() =>
              setDraft((d) => {
                const last = d.bands[d.bands.length - 1];
                return { ...d, bands: [...d.bands, { from_ngn: (last?.from_ngn ?? 0) * 2 || 1000, seconds: Math.min(900, (last?.seconds ?? 60) + 60) }] };
              })
            }
          >
            <Plus className="h-4 w-4 mr-1" /> Add band
          </Button>
        </div>

        <div className="rounded-md bg-muted/50 p-3 text-sm">
          <p className="font-medium mb-1">What sprays get</p>
          <div className="grid grid-cols-2 md:grid-cols-3 gap-x-6 gap-y-1">
            {SAMPLE_AMOUNTS.map((a) => (
              <span key={a}>
                {naira(a)} → <strong>{minutes(floorTimeFor(draft, a))}</strong>
              </span>
            ))}
          </div>
        </div>

        <div className="grid md:grid-cols-3 gap-4">
          <div>
            <Label htmlFor="busy-threshold">Busy when more than … waiting</Label>
            <Input id="busy-threshold" type="number" min={1} value={draft.busy_threshold} onChange={(e) => setDraft((d) => ({ ...d, busy_threshold: Number(e.target.value) }))} />
          </div>
          <div>
            <Label htmlFor="busy-shrink">Then shrink turns by (%)</Label>
            <Input id="busy-shrink" type="number" min={0} max={70} value={draft.busy_shrink_pct} onChange={(e) => setDraft((d) => ({ ...d, busy_shrink_pct: Number(e.target.value) }))} />
          </div>
          <div>
            <Label htmlFor="min-seconds">Never below (seconds)</Label>
            <Input id="min-seconds" type="number" min={15} value={draft.min_seconds} onChange={(e) => setDraft((d) => ({ ...d, min_seconds: Number(e.target.value) }))} />
          </div>
          <div>
            <Label htmlFor="max-wait">Max wait in line (minutes)</Label>
            <Input
              id="max-wait"
              type="number"
              min={5}
              max={120}
              value={Math.round(draft.max_wait_seconds / 60)}
              onChange={(e) => setDraft((d) => ({ ...d, max_wait_seconds: Number(e.target.value) * 60 }))}
            />
          </div>
        </div>

        {problem || serverError ? <p className="text-sm text-destructive">{problem ?? serverError}</p> : null}
        <div className="flex gap-3">
          <Button type="button" onClick={() => void save()} disabled={!changed || Boolean(problem) || saving}>
            {saving ? <Loader2 className="h-4 w-4 animate-spin mr-2" /> : null}
            Save
          </Button>
          <Button type="button" variant="outline" disabled={!changed || saving} onClick={() => saved && setDraft(saved)}>
            Reset
          </Button>
        </div>
      </CardContent>
    </Card>
  );
}

function FloorAvatarModeration() {
  const [search, setSearch] = useState("");
  const [rows, setRows] = useState<FloorAvatar[]>([]);
  const [loading, setLoading] = useState(true);
  const [removing, setRemoving] = useState<string | null>(null);

  const load = useCallback(async (q: string) => {
    setLoading(true);
    const { data, error } = await adminApi.danceFloor.listAvatars(q.trim() || null);
    setRows(error ? [] : ((data ?? []) as FloorAvatar[]));
    setLoading(false);
    if (error) toast.error(error.message);
  }, []);

  useEffect(() => {
    const t = window.setTimeout(() => void load(search), 300);
    return () => window.clearTimeout(t);
  }, [search, load]);

  async function remove(row: FloorAvatar) {
    const reason = window.prompt(`Why remove ${row.full_name || row.username || "this guest"}'s floor avatar?`, "Inappropriate avatar");
    if (reason === null) return;
    setRemoving(row.user_id);
    const { error } = await adminApi.danceFloor.removeAvatar(row.user_id, reason);
    setRemoving(null);
    if (error) {
      toast.error(error.message);
      return;
    }
    toast.success("Floor avatar removed. They'll dance as a stand-in.");
    setRows((r) => r.filter((x) => x.user_id !== row.user_id));
  }

  const sorted = useMemo(() => rows, [rows]);

  return (
    <Card>
      <CardHeader>
        <CardTitle className="text-base">Floor avatars</CardTitle>
        <CardDescription>
          Guests' 3D avatars shown on the dance floor and big screen. Removing one puts them back to a stand-in until they
          save a new avatar.
        </CardDescription>
      </CardHeader>
      <CardContent className="space-y-3">
        <Input placeholder="Search by name or @username" value={search} onChange={(e) => setSearch(e.target.value)} aria-label="Search floor avatars" />
        {loading ? (
          <div className="flex justify-center py-6">
            <Loader2 className="h-6 w-6 animate-spin text-muted-foreground" />
          </div>
        ) : sorted.length === 0 ? (
          <p className="text-sm text-muted-foreground py-4 text-center">No floor avatars{search ? " match that search" : " yet"}.</p>
        ) : (
          <ul className="divide-y">
            {sorted.map((row) => (
              <li key={row.user_id} className="flex items-center gap-3 py-2">
                {row.avatar_url ? (
                  <img src={row.avatar_url} alt="" className="h-10 w-10 rounded-full object-cover bg-muted" />
                ) : (
                  <span className="h-10 w-10 rounded-full bg-muted" />
                )}
                <div className="flex-1 min-w-0">
                  <p className="text-sm font-medium truncate">{row.full_name || "Unnamed guest"}</p>
                  <p className="text-xs text-muted-foreground truncate">
                    {row.username ? `@${row.username}` : "no username"} · updated {new Date(row.floor_version).toLocaleString()}
                  </p>
                </div>
                <Button type="button" variant="outline" size="sm" disabled={removing === row.user_id} onClick={() => void remove(row)}>
                  {removing === row.user_id ? <Loader2 className="h-4 w-4 animate-spin" /> : <UserX className="h-4 w-4 mr-1" />}
                  Remove floor avatar
                </Button>
              </li>
            ))}
          </ul>
        )}
      </CardContent>
    </Card>
  );
}
