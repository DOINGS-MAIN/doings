import { useEffect, useState } from "react";
import { Gift, Loader2 } from "lucide-react";
import { toast } from "sonner";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Switch } from "@/components/ui/switch";
import { supabase } from "@/lib/supabase";

const KOBO = 100;

// "200,000" or "200000" → whole naira, or null when it isn't a whole, non-negative number.
export function parseNairaLimit(text: string): number | null {
  const cleaned = text.replace(/[,\s]/g, "");
  if (!/^\d+$/.test(cleaned)) return null;
  const n = Number(cleaned);
  return Number.isSafeInteger(n * KOBO) ? n : null;
}

type Limits = { shareL1: string; shareL2: string; giveawayL1: string; giveawayL2: string };
const EMPTY: Limits = { shareL1: "", shareL2: "", giveawayL1: "", giveawayL2: "" };
const naira = (kobo: unknown) => String(Math.floor(Number(kobo ?? 0) / KOBO));

/** What the form will save, or the reason it can't be saved. */
export function giftingPayload(requiresIdentity: boolean, limits: Limits):
  | { error: string }
  | { _share_requires_identity: boolean; _share_l1_kobo: number; _share_l2_kobo: number; _giveaway_l1_kobo: number; _giveaway_l2_kobo: number } {
  const values = [limits.shareL1, limits.shareL2, limits.giveawayL1, limits.giveawayL2].map(parseNairaLimit);
  if (values.some((v) => v === null)) return { error: "Enter each limit as a whole number of naira" };
  const [shareL1, shareL2, giveawayL1, giveawayL2] = values as number[];
  if (shareL2 < shareL1 || giveawayL2 < giveawayL1) {
    return { error: "A verified limit cannot be lower than the email-only limit" };
  }
  return {
    _share_requires_identity: requiresIdentity,
    _share_l1_kobo: shareL1 * KOBO,
    _share_l2_kobo: shareL2 * KOBO,
    _giveaway_l1_kobo: giveawayL1 * KOBO,
    _giveaway_l2_kobo: giveawayL2 * KOBO,
  };
}

export type LimitsForm = {
  minPurchase: string; minSell: string; sellDaily: string; sprayMax: string;
  sprayDailyL1: string; sprayDailyL2: string; giveawayMinTotal: string; giveawayMinEach: string;
};
const EMPTY_LIMITS: LimitsForm = {
  minPurchase: "", minSell: "", sellDaily: "", sprayMax: "", sprayDailyL1: "", sprayDailyL2: "", giveawayMinTotal: "", giveawayMinEach: "",
};

/** What the limits form will save (set_platform_limits), or the reason it can't be saved. */
export function limitsPayload(form: LimitsForm):
  | { error: string }
  | {
      _bundle_min_purchase: number; _bundle_sell_min: number; _sell_daily_limit_kobo: number; _spray_max_single_kobo: number;
      _spray_daily_l1_kobo: number; _spray_daily_l2_kobo: number; _giveaway_min_total_kobo: number; _giveaway_min_per_person_kobo: number;
    } {
  const order = ["minPurchase", "minSell", "sellDaily", "sprayMax", "sprayDailyL1", "sprayDailyL2", "giveawayMinTotal", "giveawayMinEach"] as const;
  const values = order.map((k) => parseNairaLimit(form[k]));
  if (values.some((v) => v === null)) return { error: "Enter each limit as a whole number" };
  const [minPurchase, minSell, sellDaily, sprayMax, sprayL1, sprayL2, giveTotal, giveEach] = values as number[];
  if (minPurchase < 1 || minSell < 1 || giveTotal < 1 || giveEach < 1) return { error: "A minimum must be at least 1" };
  if (sellDaily < 1) return { error: "The daily sale limit must be more than 0" };
  if ((sprayL1 > 0 && sprayL1 < 200) || (sprayL2 > 0 && sprayL2 < 200)) {
    return { error: "A daily spray limit must be 0 (sprays off) or at least 200 bundles" };
  }
  if (sprayL2 < sprayL1) return { error: "A verified limit cannot be lower than the email-only limit" };
  if (giveEach > giveTotal) return { error: "The smallest share per person cannot be more than the smallest giveaway" };
  if (sprayMax < 200) return { error: "The largest spray must be at least 200 bundles (one note)" };
  return {
    _bundle_min_purchase: minPurchase,
    _bundle_sell_min: minSell,
    _sell_daily_limit_kobo: sellDaily * KOBO,
    _spray_max_single_kobo: sprayMax * KOBO,
    _spray_daily_l1_kobo: sprayL1 * KOBO,
    _spray_daily_l2_kobo: sprayL2 * KOBO,
    _giveaway_min_total_kobo: giveTotal * KOBO,
    _giveaway_min_per_person_kobo: giveEach * KOBO,
  };
}

/**
 * Super admins choose which identity checks selling needs (BVN, selfie), whether sharing bundles
 * needs BVN and selfie, and how much one person may share or give away in a day.
 */
export function GiftingSettingsCard() {
  const [requiresIdentity, setRequiresIdentity] = useState(false);
  // Both selling checks default to on: if the settings can't be read, nothing looser is ever saved.
  const [sellBvn, setSellBvn] = useState(true);
  const [sellSelfie, setSellSelfie] = useState(true);
  const [loaded, setLoaded] = useState(false);
  // What the server had when this card loaded: the selling checks are only sent when they changed,
  // so a save of the limits from a stale tab can't undo another admin's switch.
  const [savedSell, setSavedSell] = useState({ bvn: true, selfie: true });
  const [amounts, setAmounts] = useState<LimitsForm>(EMPTY_LIMITS);
  // As loaded, to send the other limits only when one of them was changed.
  const [savedAmounts, setSavedAmounts] = useState<LimitsForm>(EMPTY_LIMITS);
  const [amountsLoaded, setAmountsLoaded] = useState(false);
  const [limits, setLimits] = useState<Limits>(EMPTY);
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);

  const load = async () => {
    setLoading(true);
    const { data, error } = await supabase.rpc("get_gifting_settings");
    setLoading(false);
    if (error) {
      toast.error(error.message || "Couldn't load the gifting settings");
      return;
    }
    const s = (data ?? {}) as Record<string, unknown>;
    setRequiresIdentity(s.share_requires_identity === true);
    setSellBvn(s.sell_requires_bvn !== false);
    setSellSelfie(s.sell_requires_selfie !== false);
    setSavedSell({ bvn: s.sell_requires_bvn !== false, selfie: s.sell_requires_selfie !== false });
    setLoaded(true);
    const { data: limitData, error: limitError } = await supabase.rpc("get_platform_limits");
    if (limitError) {
      // The switches and sharing limits above can still be saved; the other limits are left alone.
      setAmountsLoaded(false);
      toast.error("Couldn't load the buying, selling and spray limits. They are left unchanged.");
      return;
    }
    const l = (limitData ?? {}) as Record<string, unknown>;
    const loadedAmounts: LimitsForm = {
      minPurchase: String(Number(l.bundle_min_purchase ?? 0)),
      minSell: String(Number(l.bundle_sell_min ?? 0)),
      sellDaily: naira(l.sell_daily_limit_kobo),
      sprayMax: naira(l.spray_max_single_kobo),
      sprayDailyL1: naira(l.spray_daily_l1_kobo),
      sprayDailyL2: naira(l.spray_daily_l2_kobo),
      giveawayMinTotal: naira(l.giveaway_min_total_kobo),
      giveawayMinEach: naira(l.giveaway_min_per_person_kobo),
    };
    setAmounts(loadedAmounts);
    setSavedAmounts(loadedAmounts);
    setAmountsLoaded(true);
    setLimits({
      shareL1: naira(s.share_l1_kobo),
      shareL2: naira(s.share_l2_kobo),
      giveawayL1: naira(s.giveaway_l1_kobo),
      giveawayL2: naira(s.giveaway_l2_kobo),
    });
  };

  useEffect(() => {
    void load();
  }, []);

  const save = async () => {
    const payload = giftingPayload(requiresIdentity, limits);
    if ("error" in payload) {
      toast.error(payload.error);
      return;
    }
    if (!loaded) {
      toast.error("The settings haven't loaded yet. Reload the page and try again.");
      return;
    }
    const amountsChanged = amountsLoaded && (Object.keys(amounts) as (keyof LimitsForm)[]).some((k) => amounts[k] !== savedAmounts[k]);
    const amountsPayload = limitsPayload(amounts);
    if (amountsChanged && "error" in amountsPayload) {
      toast.error(amountsPayload.error);
      return;
    }
    const sellChanged = sellBvn !== savedSell.bvn || sellSelfie !== savedSell.selfie;
    if (sellChanged) {
      const warning = !sellBvn
        ? "With the BVN check off, payouts go to ANY bank account a seller gives, with no name check."
        : !sellSelfie
          ? "With the selfie check off, anyone who knows a BVN can verify as its owner."
          : "This changes what people must do before selling.";
      if (!window.confirm(`${warning} Save the selling checks?`)) return;
    }
    setSaving(true);
    const { error } = await supabase.rpc("set_gifting_settings", payload);
    if (error) {
      setSaving(false);
      toast.error(error.message || "Couldn't save the settings");
      return;
    }
    const { error: sellError } = sellChanged
      ? await supabase.rpc("set_sell_identity_settings", { _requires_bvn: sellBvn, _requires_selfie: sellSelfie })
      : { error: null };
    if (sellError) {
      setSaving(false);
      toast.error(`Sharing and giveaway settings were saved, but the selling checks${amountsChanged ? " and the other limits" : ""} were not: ${sellError.message || "please try again"}`);
      void load();
      return;
    }
    const { error: amountsError } = amountsChanged && !("error" in amountsPayload)
      ? await supabase.rpc("set_platform_limits", amountsPayload)
      : { error: null };
    setSaving(false);
    if (amountsError) {
      toast.error(`The switches and daily sharing limits were saved, but the other limits were not: ${amountsError.message || "please try again"}`);
      void load();
      return;
    }
    toast.success("Settings saved");
    void load();
  };

  const busy = loading || saving;
  const field = (id: keyof Limits, label: string) => (
    <div className="space-y-2">
      <Label htmlFor={`gifting-${id}`}>{label}</Label>
      <Input
        id={`gifting-${id}`}
        inputMode="numeric"
        value={limits[id]}
        onChange={(e) => setLimits((prev) => ({ ...prev, [id]: e.target.value }))}
        disabled={busy}
      />
    </div>
  );

  const amountField = (id: keyof LimitsForm, label: string) => (
    <div className="space-y-2">
      <Label htmlFor={`limit-${id}`}>{label}</Label>
      <Input
        id={`limit-${id}`}
        inputMode="numeric"
        value={amounts[id]}
        onChange={(e) => setAmounts((prev) => ({ ...prev, [id]: e.target.value }))}
        disabled={busy || !amountsLoaded}
      />
    </div>
  );

  return (
    <Card className="bg-card border-border">
      <CardHeader>
        <CardTitle className="text-lg flex items-center gap-2">
          <Gift className="w-5 h-5 text-muted-foreground" />
          Gifting, selling and limits
        </CardTitle>
        <CardDescription>
          Which checks a person passes before selling bundles back, whether sharing needs them too, and daily limits.
          Limits are in naira per person per day (1 bundle = ₦1); the day resets at 1:00 am Lagos time.
        </CardDescription>
      </CardHeader>
      <CardContent className="space-y-6">
        <div className="space-y-3">
          <p className="text-sm font-medium">Selling bundles back</p>
          <div className="flex items-start justify-between gap-4 rounded-lg border border-border p-4">
            <div className="space-y-1">
              <Label htmlFor="selling-requires-bvn" className="text-sm font-medium">Require BVN to sell</Label>
              <p className={`text-xs max-w-xl ${sellBvn ? "text-muted-foreground" : "text-destructive"}`}>
                {sellBvn
                  ? "On: sellers give their BVN once, and payouts only go to a bank account in their BVN name."
                  : "Off: no BVN is asked for, and payouts go to any bank account the seller gives. There is no name check."}
              </p>
            </div>
            <Switch id="selling-requires-bvn" checked={sellBvn} onCheckedChange={setSellBvn} disabled={busy} />
          </div>
          <div className="flex items-start justify-between gap-4 rounded-lg border border-border p-4">
            <div className="space-y-1">
              <Label htmlFor="selling-requires-selfie" className="text-sm font-medium">Require a selfie to sell</Label>
              <p className="text-xs text-muted-foreground max-w-xl">
                {sellSelfie
                  ? sellBvn
                    ? "On: sellers take a live selfie, which is matched to the photo on their BVN."
                    : "On: sellers take a live selfie. Without BVN it shows a real person is there, not who they are."
                  : sellBvn
                    ? "Off: no selfie is asked for. Anyone who knows a BVN can verify as its owner, and gets the BVN verified limits below."
                    : "Off: no selfie is asked for."}
              </p>
            </div>
            <Switch id="selling-requires-selfie" checked={sellSelfie} onCheckedChange={setSellSelfie} disabled={busy} />
          </div>
          <p className="text-xs text-muted-foreground">
            Turning a check on applies to everyone who has not passed it. When both are on, the selfie is matched to
            the BVN, so someone who gave only a BVN (or only a selfie) is asked for both together.
          </p>
        </div>

        <div className="flex items-start justify-between gap-4 rounded-lg border border-border p-4">
          <div className="space-y-1">
            <Label htmlFor="gifting-requires-identity" className="text-sm font-medium">
              Require BVN and selfie to share bundles
            </Label>
            <p className="text-xs text-muted-foreground max-w-xl">
              {requiresIdentity
                ? "On: only people who have completed BVN and selfie can share bundles with others."
                : "Off: a verified email is enough to share bundles. BVN and selfie are asked for only when someone sells."}
            </p>
          </div>
          <Switch id="gifting-requires-identity" checked={requiresIdentity} onCheckedChange={setRequiresIdentity} disabled={busy} />
        </div>

        <div className="space-y-3">
          <p className="text-sm font-medium">Sharing with another person</p>
          <div className="grid gap-4 sm:grid-cols-2">
            {field("shareL1", "Verified email only (₦ per day)")}
            {field("shareL2", "BVN verified (₦ per day)")}
          </div>
          {requiresIdentity && (
            <p className="text-xs text-muted-foreground">The email-only limit is not used while BVN is required to share.</p>
          )}
        </div>

        <div className="space-y-3">
          <p className="text-sm font-medium">Giveaways</p>
          <div className="grid gap-4 sm:grid-cols-2">
            {field("giveawayL1", "Verified email only (₦ per day)")}
            {field("giveawayL2", "BVN verified (₦ per day)")}
          </div>
          <p className="text-xs text-muted-foreground">Giveaways that were stopped still count. A limit of 0 switches that action off for that level.</p>
        </div>

        <div className="space-y-3">
          <p className="text-sm font-medium">Buying and selling</p>
          <div className="grid gap-4 sm:grid-cols-3">
            {amountField("minPurchase", "Smallest purchase (bundles)")}
            {amountField("minSell", "Smallest sale (bundles)")}
            {amountField("sellDaily", "Most one person can sell (₦ per day)")}
          </div>
          <p className="text-xs text-muted-foreground">The daily sale limit is the same for every seller, whichever checks they passed.</p>
        </div>

        <div className="space-y-3">
          <p className="text-sm font-medium">Sprays</p>
          <div className="grid gap-4 sm:grid-cols-3">
            {amountField("sprayMax", "Largest single spray (bundles)")}
            {amountField("sprayDailyL1", "Verified email only (₦ per day)")}
            {amountField("sprayDailyL2", "BVN verified (₦ per day)")}
          </div>
          <p className="text-xs text-muted-foreground">A spray counts from the moment it joins the line. One let go without being charged does not count.</p>
        </div>

        <div className="space-y-3">
          <p className="text-sm font-medium">Giveaway sizes</p>
          <div className="grid gap-4 sm:grid-cols-2">
            {amountField("giveawayMinTotal", "Smallest giveaway (bundles)")}
            {amountField("giveawayMinEach", "Smallest share per person (bundles)")}
          </div>
        </div>

        <Button onClick={save} disabled={busy}>
          {saving ? <Loader2 className="w-4 h-4 mr-2 animate-spin" /> : null}
          Save settings
        </Button>
      </CardContent>
    </Card>
  );
}
