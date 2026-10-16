import { useCallback, useEffect, useState } from "react";
import { Navigate } from "react-router-dom";
import { Loader2, Megaphone, Pause, Pencil, Play, Plus, Trash2 } from "lucide-react";
import { toast } from "sonner";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Badge } from "@/components/ui/badge";
import { Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import {
  AlertDialog,
  AlertDialogAction,
  AlertDialogCancel,
  AlertDialogContent,
  AlertDialogDescription,
  AlertDialogFooter,
  AlertDialogHeader,
  AlertDialogTitle,
} from "@/components/ui/alert-dialog";
import { useAdminAuth } from "@/hooks/useAdminAuth";
import { admin as adminApi } from "@/lib/supabase";
import { ROLE_PERMISSIONS } from "@/types/admin";
import {
  AD_IMAGE_BASE,
  adAspectWarning,
  adImageError,
  adLinkError,
  adStatus,
  tapRate,
  type AdStatus,
  type AdminAd,
} from "@/lib/adsAdmin";

const can = (role: string | undefined, permission: string) => {
  const permissions = ROLE_PERMISSIONS[role as keyof typeof ROLE_PERMISSIONS] ?? [];
  return permissions.includes("*") || permissions.includes(permission);
};

const STATUS_CLASS: Record<AdStatus, string> = {
  Live: "bg-green-100 text-green-800 hover:bg-green-100",
  Scheduled: "bg-blue-100 text-blue-800 hover:bg-blue-100",
  Ended: "bg-muted text-muted-foreground hover:bg-muted",
  Paused: "bg-amber-100 text-amber-800 hover:bg-amber-100",
};

/** Remove files from the ads bucket; say so when storage removed fewer than asked (nothing fails silently). */
async function removeImages(paths: string[]) {
  if (paths.length === 0) return;
  const { data, error } = await adminApi.ads.removeFiles(paths);
  if (error || (data?.length ?? 0) < paths.length) {
    toast.warning("Some old images couldn't be removed from storage. They're unused; tell an engineer to clear them.");
  }
}

const when = (iso: string | null) => (iso ? new Date(iso).toLocaleString("en-NG") : "No end");

/** ISO → the value a datetime-local input shows (local time). */
function toLocalInput(iso: string | null): string {
  if (!iso) return "";
  const d = new Date(iso);
  const pad = (n: number) => String(n).padStart(2, "0");
  return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}T${pad(d.getHours())}:${pad(d.getMinutes())}`;
}

/** Managed ads (migration 092): the new app's home banner. super_admin and moderation. */
export const AdminAds = () => {
  const { currentAccount } = useAdminAuth();
  const [ads, setAds] = useState<AdminAd[]>([]);
  const [loading, setLoading] = useState(true);
  const [editing, setEditing] = useState<AdminAd | "new" | null>(null);
  const [deleting, setDeleting] = useState<AdminAd | null>(null);
  const [busy, setBusy] = useState<string | null>(null);

  const load = useCallback(async () => {
    setLoading(true);
    const { data, error } = await adminApi.ads.list();
    setAds(error ? [] : ((data ?? []) as AdminAd[]));
    setLoading(false);
    if (error) toast.error(error.message);
  }, []);

  useEffect(() => {
    void load();
  }, [load]);

  if (!currentAccount || !can(currentAccount.role, "ads")) return <Navigate to="/admin" replace />;

  async function toggle(ad: AdminAd) {
    setBusy(ad.id);
    const { error } = await adminApi.ads.setActive(ad.id, !ad.is_active);
    setBusy(null);
    if (error) return void toast.error(error.message);
    toast.success(ad.is_active ? "Ad paused" : "Ad resumed");
    void load();
  }

  async function remove(ad: AdminAd) {
    setBusy(ad.id);
    const { data, error } = await adminApi.ads.remove(ad.id);
    if (error) {
      setBusy(null);
      return void toast.error(error.message);
    }
    await removeImages((data ?? []) as string[]);
    setBusy(null);
    setDeleting(null);
    toast.success("Ad deleted");
    void load();
  }

  return (
    <div className="space-y-6 max-w-5xl">
      <div className="flex items-start justify-between gap-4">
        <div>
          <h1 className="text-2xl font-bold flex items-center gap-2">
            <Megaphone className="h-6 w-6 text-primary" />
            Ads
          </h1>
          <p className="text-muted-foreground mt-1">
            The home banner in the new app. Live ads rotate, highest priority first. Times are in your local time zone.
          </p>
        </div>
        <Button type="button" onClick={() => setEditing("new")}>
          <Plus className="h-4 w-4 mr-1" /> New ad
        </Button>
      </div>

      <Card>
        <CardHeader>
          <CardTitle className="text-base">Home banner</CardTitle>
          <CardDescription>Views count each person once a day per ad; tap rate is taps ÷ views.</CardDescription>
        </CardHeader>
        <CardContent>
          {loading ? (
            <div className="flex justify-center py-6">
              <Loader2 className="h-6 w-6 animate-spin text-muted-foreground" />
            </div>
          ) : ads.length === 0 ? (
            <p className="text-sm text-muted-foreground py-6 text-center">No ads yet. The home banner is hidden until an ad is live.</p>
          ) : (
            <ul className="divide-y">
              {ads.map((ad) => {
                const status = adStatus(ad);
                return (
                  <li key={ad.id} className="flex flex-wrap items-center gap-4 py-3">
                    <img src={AD_IMAGE_BASE + ad.image_mobile_path} alt="" className="h-12 w-36 rounded object-cover bg-muted" />
                    <div className="flex-1 min-w-[200px]">
                      <p className="text-sm font-medium flex items-center gap-2">
                        {ad.title} <Badge className={STATUS_CLASS[status]}>{status}</Badge>
                      </p>
                      <p className="text-xs text-muted-foreground">
                        {when(ad.starts_at)} → {when(ad.ends_at)} · priority {ad.priority}
                        {ad.link_url ? ` · ${ad.link_url}` : " · no link"}
                      </p>
                    </div>
                    <div className="text-xs text-muted-foreground tabular-nums w-40">
                      {ad.views.toLocaleString()} views · {ad.taps.toLocaleString()} taps · {tapRate(ad.views, ad.taps)}
                    </div>
                    <div className="flex gap-2">
                      <Button type="button" variant="outline" size="sm" onClick={() => setEditing(ad)} aria-label={`Edit ${ad.title}`}>
                        <Pencil className="h-4 w-4" />
                      </Button>
                      <Button
                        type="button"
                        variant="outline"
                        size="sm"
                        disabled={busy === ad.id}
                        onClick={() => void toggle(ad)}
                        aria-label={ad.is_active ? `Pause ${ad.title}` : `Resume ${ad.title}`}
                      >
                        {ad.is_active ? <Pause className="h-4 w-4" /> : <Play className="h-4 w-4" />}
                      </Button>
                      <Button type="button" variant="outline" size="sm" onClick={() => setDeleting(ad)} aria-label={`Delete ${ad.title}`}>
                        <Trash2 className="h-4 w-4" />
                      </Button>
                    </div>
                  </li>
                );
              })}
            </ul>
          )}
        </CardContent>
      </Card>

      {editing ? (
        <AdEditor
          ad={editing === "new" ? null : editing}
          onClose={() => setEditing(null)}
          onSaved={() => {
            setEditing(null);
            void load();
          }}
        />
      ) : null}

      <AlertDialog open={Boolean(deleting)} onOpenChange={(open) => !open && setDeleting(null)}>
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>Delete "{deleting?.title}"?</AlertDialogTitle>
            <AlertDialogDescription>This can't be undone. Its images and counts are removed too.</AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel>Cancel</AlertDialogCancel>
            <AlertDialogAction
              disabled={Boolean(deleting && busy === deleting.id)}
              onClick={(e) => {
                e.preventDefault();
                if (deleting) void remove(deleting);
              }}
            >
              Delete
            </AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>
    </div>
  );
};

type Picked = { file: File; preview: string; error: string | null; warning: string | null };

function useImagePick(kind: "mobile" | "desktop") {
  const [picked, setPicked] = useState<Picked | null>(null);
  useEffect(() => () => (picked ? URL.revokeObjectURL(picked.preview) : undefined), [picked]);
  function pick(file: File | undefined) {
    if (!file) return setPicked(null);
    const preview = URL.createObjectURL(file);
    const error = adImageError(file);
    setPicked({ file, preview, error, warning: null });
    if (error) return;
    const img = new Image();
    img.onload = () =>
      setPicked((p) => (p && p.file === file ? { ...p, warning: adAspectWarning(img.naturalWidth, img.naturalHeight, kind) } : p));
    img.src = preview;
  }
  return { picked, pick };
}

function AdEditor({ ad, onClose, onSaved }: { ad: AdminAd | null; onClose: () => void; onSaved: () => void }) {
  const [title, setTitle] = useState(ad?.title ?? "");
  const [link, setLink] = useState(ad?.link_url ?? "");
  const [priority, setPriority] = useState(String(ad?.priority ?? 0));
  const [startsAt, setStartsAt] = useState(toLocalInput(ad?.starts_at ?? new Date().toISOString()));
  const [endsAt, setEndsAt] = useState(toLocalInput(ad?.ends_at ?? null));
  const [keepDesktop, setKeepDesktop] = useState(Boolean(ad?.image_desktop_path));
  const mobile = useImagePick("mobile");
  const desktop = useImagePick("desktop");
  const [saving, setSaving] = useState(false);

  const linkError = adLinkError(link.trim());
  const datesError = endsAt && startsAt && new Date(endsAt) <= new Date(startsAt) ? "The end must be after the start" : null;
  const problem =
    (!title.trim() && "Add a title") ||
    (title.trim().length > 80 && "Keep the title to 80 characters") ||
    (!ad && !mobile.picked && "Choose a mobile image") ||
    mobile.picked?.error ||
    desktop.picked?.error ||
    linkError ||
    datesError ||
    (!/^-?\d+$/.test(priority.trim()) && "Priority must be a whole number") ||
    null;

  async function save() {
    if (problem) return;
    setSaving(true);
    const uploaded: string[] = [];
    try {
      const mobilePath = mobile.picked ? await adminApi.ads.upload(mobile.picked.file) : ad!.image_mobile_path;
      if (mobile.picked) uploaded.push(mobilePath);
      const desktopPath = desktop.picked
        ? await adminApi.ads.upload(desktop.picked.file)
        : keepDesktop
          ? (ad?.image_desktop_path ?? null)
          : null;
      if (desktop.picked && desktopPath) uploaded.push(desktopPath);

      const { error } = await adminApi.ads.upsert({
        id: ad?.id ?? null,
        title: title.trim(),
        mobile: mobilePath,
        desktop: desktopPath,
        link: link.trim() || null,
        priority: Number(priority.trim()),
        startsAt: new Date(startsAt || Date.now()).toISOString(),
        endsAt: endsAt ? new Date(endsAt).toISOString() : null,
      });
      if (error) throw error;

      // Saved: the files this ad no longer uses can go.
      const replaced = [
        ad && mobile.picked ? ad.image_mobile_path : null,
        ad?.image_desktop_path && ad.image_desktop_path !== desktopPath ? ad.image_desktop_path : null,
      ].filter((p): p is string => Boolean(p));
      await removeImages(replaced);
      toast.success("Ad saved");
      onSaved();
    } catch (e) {
      await removeImages(uploaded);
      toast.error(e instanceof Error ? e.message : (e as { message?: string })?.message ?? "Couldn't save the ad");
    } finally {
      setSaving(false);
    }
  }

  const mobileSrc = mobile.picked?.preview ?? (ad ? AD_IMAGE_BASE + ad.image_mobile_path : null);
  const desktopSrc = desktop.picked?.preview ?? (keepDesktop && ad?.image_desktop_path ? AD_IMAGE_BASE + ad.image_desktop_path : null);

  return (
    <Dialog open onOpenChange={(open) => !open && !saving && onClose()}>
      <DialogContent className="max-w-2xl max-h-[90vh] overflow-y-auto">
        <DialogHeader>
          <DialogTitle>{ad ? "Edit ad" : "New ad"}</DialogTitle>
          <DialogDescription>Images: JPEG, PNG or WebP, up to 1 MB. Mobile about 960×319, desktop about 1083×131.</DialogDescription>
        </DialogHeader>

        <div className="space-y-4">
          <div className="space-y-1.5">
            <Label htmlFor="ad-title">Title</Label>
            <Input id="ad-title" value={title} maxLength={80} onChange={(e) => setTitle(e.target.value)} placeholder="Shown to screen readers too" />
          </div>

          <ImageField
            id="ad-mobile"
            label={ad ? "Mobile image (choose to replace)" : "Mobile image"}
            aspect="aspect-[960/319]"
            src={mobileSrc}
            picked={mobile.picked}
            onPick={mobile.pick}
          />
          <ImageField
            id="ad-desktop"
            label="Desktop image (optional: the mobile image is used when empty)"
            aspect="aspect-[1083/131]"
            src={desktopSrc}
            picked={desktop.picked}
            onPick={desktop.pick}
            onClear={
              desktopSrc
                ? () => {
                    desktop.pick(undefined);
                    setKeepDesktop(false);
                  }
                : undefined
            }
          />

          <div className="space-y-1.5">
            <Label htmlFor="ad-link">Link (optional)</Label>
            <Input id="ad-link" value={link} onChange={(e) => setLink(e.target.value)} placeholder="https://… or /event/ABC123" />
            {linkError ? <p className="text-xs text-destructive">{linkError}</p> : null}
          </div>

          <div className="grid grid-cols-1 sm:grid-cols-3 gap-3">
            <div className="space-y-1.5">
              <Label htmlFor="ad-priority">Priority</Label>
              <Input id="ad-priority" inputMode="numeric" value={priority} onChange={(e) => setPriority(e.target.value)} />
            </div>
            <div className="space-y-1.5">
              <Label htmlFor="ad-start">Starts</Label>
              <Input id="ad-start" type="datetime-local" value={startsAt} onChange={(e) => setStartsAt(e.target.value)} />
            </div>
            <div className="space-y-1.5">
              <Label htmlFor="ad-end">Ends (optional)</Label>
              <Input id="ad-end" type="datetime-local" value={endsAt} onChange={(e) => setEndsAt(e.target.value)} />
            </div>
          </div>
          {datesError ? <p className="text-xs text-destructive">{datesError}</p> : null}
        </div>

        <DialogFooter>
          <Button type="button" variant="outline" disabled={saving} onClick={onClose}>
            Cancel
          </Button>
          <Button type="button" disabled={Boolean(problem) || saving} onClick={() => void save()} title={problem || undefined}>
            {saving ? <Loader2 className="h-4 w-4 animate-spin mr-2" /> : null}
            Save
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}

function ImageField({
  id, label, aspect, src, picked, onPick, onClear,
}: {
  id: string;
  label: string;
  aspect: string;
  src: string | null;
  picked: Picked | null;
  onPick: (file: File | undefined) => void;
  onClear?: () => void;
}) {
  return (
    <div className="space-y-1.5">
      <Label htmlFor={id}>{label}</Label>
      <div className="flex items-center gap-2">
        <Input id={id} type="file" accept="image/jpeg,image/png,image/webp" onChange={(e) => onPick(e.target.files?.[0])} />
        {onClear ? (
          <Button type="button" variant="ghost" size="sm" onClick={onClear}>
            Remove
          </Button>
        ) : null}
      </div>
      {src ? (
        <div className={`${aspect} w-full overflow-hidden rounded-lg bg-muted`}>
          <img src={src} alt="" className="h-full w-full object-cover" />
        </div>
      ) : null}
      {picked?.error ? <p className="text-xs text-destructive">{picked.error}</p> : null}
      {picked?.warning ? <p className="text-xs text-amber-700">{picked.warning}</p> : null}
    </div>
  );
}
