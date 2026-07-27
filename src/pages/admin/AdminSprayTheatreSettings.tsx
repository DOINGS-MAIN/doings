import { useEffect, useState } from "react";
import { Navigate } from "react-router-dom";
import { Loader2, Sparkles, Timer, Gauge } from "lucide-react";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { useSprayTheatreSettings } from "@/hooks/useSprayTheatreSettings";
import { useAdminAuth } from "@/hooks/useAdminAuth";
import { ROLE_PERMISSIONS } from "@/types/admin";
import { toast } from "sonner";
import {
  computeSprayTheatrePlan,
  DEFAULT_SPRAY_THEATRE_SETTINGS,
  type QueueCompressionTier,
} from "@/lib/sprayTheatrePlan";

function canAccessSprayTheatre(role: string) {
  const permissions = ROLE_PERMISSIONS[role as keyof typeof ROLE_PERMISSIONS] ?? [];
  return permissions.includes("*") || permissions.includes("payment_rails");
}

function parseTiersJson(raw: string): QueueCompressionTier[] | null {
  try {
    const parsed = JSON.parse(raw) as unknown;
    if (!Array.isArray(parsed)) return null;
    for (const tier of parsed) {
      if (
        typeof tier !== "object" ||
        tier === null ||
        typeof (tier as QueueCompressionTier).min_queue !== "number" ||
        typeof (tier as QueueCompressionTier).multiplier !== "number"
      ) {
        return null;
      }
    }
    return parsed as QueueCompressionTier[];
  } catch {
    return null;
  }
}

export const AdminSprayTheatreSettings = () => {
  const { currentAccount } = useAdminAuth();
  const { settings, loading, saving, saveSettings } = useSprayTheatreSettings();

  const [min200, setMin200] = useState("3");
  const [min500, setMin500] = useState("2.5");
  const [min1000, setMin1000] = useState("2");
  const [minUsdc, setMinUsdc] = useState("4");
  const [maxSpray, setMaxSpray] = useState("1000000");
  const [guestCap, setGuestCap] = useState("180");
  const [maxStage, setMaxStage] = useState("2700");
  const [tiersJson, setTiersJson] = useState(
    JSON.stringify(DEFAULT_SPRAY_THEATRE_SETTINGS.queue_compression_tiers, null, 2),
  );

  useEffect(() => {
    if (!settings) return;
    setMin200(String(settings.stage_min_per_100k_denom_200));
    setMin500(String(settings.stage_min_per_100k_denom_500));
    setMin1000(String(settings.stage_min_per_100k_denom_1000));
    setMinUsdc(String(settings.stage_min_per_100_usdc));
    setMaxSpray(String(settings.max_single_spray_ngn));
    setGuestCap(String(settings.guest_session_cap_sec));
    setMaxStage(String(settings.max_stage_sec));
    setTiersJson(JSON.stringify(settings.queue_compression_tiers, null, 2));
  }, [settings]);

  if (!currentAccount || !canAccessSprayTheatre(currentAccount.role)) {
    return <Navigate to="/admin" replace />;
  }

  const previewPlan = settings
    ? computeSprayTheatrePlan(settings, 100_000, 500)
    : null;

  const handleSave = async () => {
    const tiers = parseTiersJson(tiersJson);
    if (!tiers) {
      toast.error("Queue compression tiers must be valid JSON array");
      return;
    }

    try {
      await saveSettings({
        stage_min_per_100k_denom_200: parseFloat(min200) || 3,
        stage_min_per_100k_denom_500: parseFloat(min500) || 2.5,
        stage_min_per_100k_denom_1000: parseFloat(min1000) || 2,
        stage_min_per_100_usdc: parseFloat(minUsdc) || 4,
        max_single_spray_ngn: parseInt(maxSpray, 10) || 1_000_000,
        guest_session_cap_sec: parseInt(guestCap, 10) || 180,
        max_stage_sec: parseInt(maxStage, 10) || 2700,
        queue_compression_tiers: tiers,
      });
      toast.success("Spray theatre settings saved");
    } catch (err) {
      toast.error(err instanceof Error ? err.message : "Failed to save");
    }
  };

  if (loading) {
    return (
      <div className="flex items-center justify-center min-h-[40vh]">
        <Loader2 className="h-8 w-8 animate-spin text-muted-foreground" />
      </div>
    );
  }

  return (
    <div className="space-y-6 max-w-4xl">
      <div>
        <h1 className="text-2xl font-bold flex items-center gap-2">
          <Sparkles className="h-6 w-6 text-primary" />
          Spray Theatre
        </h1>
        <p className="text-muted-foreground mt-1">
          Stage timing benchmarks, guest session caps, and queue compression (Phase 1 — NGN only).
        </p>
      </div>

      {previewPlan && (
        <Card className="border-primary/20 bg-primary/5">
          <CardHeader className="pb-2">
            <CardTitle className="text-base">Live preview</CardTitle>
            <CardDescription>₦100,000 spray @ ₦500 notes with current saved settings</CardDescription>
          </CardHeader>
          <CardContent className="grid grid-cols-2 md:grid-cols-4 gap-4 text-sm">
            <div>
              <p className="text-muted-foreground">Base stage</p>
              <p className="font-semibold">{previewPlan.base_stage_sec}s ({previewPlan.base_stage_min.toFixed(1)} min)</p>
            </div>
            <div>
              <p className="text-muted-foreground">Guest session</p>
              <p className="font-semibold">{previewPlan.session_duration_sec}s</p>
            </div>
            <div>
              <p className="text-muted-foreground">Note interval</p>
              <p className="font-semibold">{previewPlan.note_interval_sec.toFixed(2)}s</p>
            </div>
            <div>
              <p className="text-muted-foreground">Notes</p>
              <p className="font-semibold">{previewPlan.note_count}</p>
            </div>
          </CardContent>
        </Card>
      )}

      <Card>
        <CardHeader>
          <CardTitle className="flex items-center gap-2">
            <Timer className="h-5 w-5" />
            Stage minutes per ₦100k block
          </CardTitle>
          <CardDescription>
            Projector stage time = benchmark × (amount ÷ 100,000), capped by max stage seconds.
          </CardDescription>
        </CardHeader>
        <CardContent className="grid gap-4 md:grid-cols-3">
          <div className="space-y-2">
            <Label htmlFor="min200">₦200 notes (minutes)</Label>
            <Input id="min200" type="number" step="0.1" min="0.1" value={min200} onChange={(e) => setMin200(e.target.value)} />
          </div>
          <div className="space-y-2">
            <Label htmlFor="min500">₦500 notes (minutes)</Label>
            <Input id="min500" type="number" step="0.1" min="0.1" value={min500} onChange={(e) => setMin500(e.target.value)} />
          </div>
          <div className="space-y-2">
            <Label htmlFor="min1000">₦1,000 notes (minutes)</Label>
            <Input id="min1000" type="number" step="0.1" min="0.1" value={min1000} onChange={(e) => setMin1000(e.target.value)} />
          </div>
          <div className="space-y-2 md:col-span-3">
            <Label htmlFor="minUsdc">USDC benchmark (min per $100 — Phase 4)</Label>
            <Input id="minUsdc" type="number" step="0.1" min="0.1" value={minUsdc} onChange={(e) => setMinUsdc(e.target.value)} />
          </div>
        </CardContent>
      </Card>

      <Card>
        <CardHeader>
          <CardTitle className="flex items-center gap-2">
            <Gauge className="h-5 w-5" />
            Limits
          </CardTitle>
        </CardHeader>
        <CardContent className="grid gap-4 md:grid-cols-3">
          <div className="space-y-2">
            <Label htmlFor="maxSpray">Max single spray (₦)</Label>
            <Input id="maxSpray" type="number" min="1000" value={maxSpray} onChange={(e) => setMaxSpray(e.target.value)} />
          </div>
          <div className="space-y-2">
            <Label htmlFor="guestCap">Guest session cap (seconds)</Label>
            <Input id="guestCap" type="number" min="10" value={guestCap} onChange={(e) => setGuestCap(e.target.value)} />
          </div>
          <div className="space-y-2">
            <Label htmlFor="maxStage">Max projector stage (seconds)</Label>
            <Input id="maxStage" type="number" min="60" value={maxStage} onChange={(e) => setMaxStage(e.target.value)} />
          </div>
        </CardContent>
      </Card>

      <Card>
        <CardHeader>
          <CardTitle>Queue compression tiers</CardTitle>
          <CardDescription>
            Linear interpolation between tiers. Used on projector in Phase 3.
          </CardDescription>
        </CardHeader>
        <CardContent>
          <textarea
            className="w-full min-h-[160px] rounded-md border border-input bg-background px-3 py-2 font-mono text-xs"
            value={tiersJson}
            onChange={(e) => setTiersJson(e.target.value)}
            spellCheck={false}
          />
        </CardContent>
      </Card>

      <Button onClick={() => void handleSave()} disabled={saving}>
        {saving ? <Loader2 className="h-4 w-4 animate-spin mr-2" /> : null}
        Save settings
      </Button>
    </div>
  );
};
