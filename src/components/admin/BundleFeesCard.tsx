import { useEffect, useState } from "react";
import { Loader2, Percent } from "lucide-react";
import { toast } from "sonner";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { supabase } from "@/lib/supabase";
import { confirmDialog } from "@/lib/confirmDialog";
import { feeOn, feesFromSettings, feesPayload, sellFeeTooHigh, type FeeInputs } from "@/lib/bundleFees";

const EMPTY: FeeInputs = { buyPercent: "", buyFlat: "", sellPercent: "", sellFlat: "" };
const naira = (n: number) => new Intl.NumberFormat("en-NG", { style: "currency", currency: "NGN", maximumFractionDigits: 2 }).format(n);
const count = (n: number) => new Intl.NumberFormat("en-NG").format(n);

/**
 * Super admins set the fees people pay when they buy bundles and when they sell them back. Each fee
 * is a flat amount plus a percentage of the value. These are the fees the app charges.
 */
export function BundleFeesCard() {
  const [fees, setFees] = useState<FeeInputs>(EMPTY);
  const [saved, setSaved] = useState<FeeInputs>(EMPTY);
  const [minSell, setMinSell] = useState(0);
  const [minPurchase, setMinPurchase] = useState(0);
  const [loaded, setLoaded] = useState(false);
  const [busy, setBusy] = useState(true);

  const load = async () => {
    setBusy(true);
    const { data, error } = await supabase.rpc("get_bundle_fee_settings");
    setBusy(false);
    if (error) {
      toast.error(error.message || "Couldn't load the fees");
      return;
    }
    const s = feesFromSettings((data ?? {}) as Record<string, unknown>);
    const inputs = { buyPercent: s.buyPercent, buyFlat: s.buyFlat, sellPercent: s.sellPercent, sellFlat: s.sellFlat };
    setFees(inputs);
    setSaved(inputs);
    setMinSell(s.minSell);
    setMinPurchase(s.minPurchase);
    setLoaded(true);
  };

  useEffect(() => {
    void load();
  }, []);

  const changed = (Object.keys(fees) as (keyof FeeInputs)[]).some((k) => fees[k] !== saved[k]);
  const payload = feesPayload(fees);
  const valid = !("error" in payload);
  const sellPct = valid ? payload._sell_fee_percent : 0;
  const sellFlat = valid ? payload._sell_fee_flat_kobo / 100 : 0;
  const buyPct = valid ? payload._buy_fee_percent : 0;
  const buyFlat = valid ? payload._buy_fee_flat_kobo / 100 : 0;
  const tooHigh = valid && sellFeeTooHigh(minSell, sellPct, sellFlat);

  const save = async () => {
    if ("error" in payload) {
      toast.error(payload.error);
      return;
    }
    if (!loaded) {
      toast.error("The fees haven't loaded yet. Reload the page and try again.");
      return;
    }
    if (tooHigh) {
      toast.error("The sell fee would take all of the smallest sale. Lower the fee or raise the smallest sale.");
      return;
    }
    const ok = await confirmDialog(
      `Buying will charge ${naira(buyFlat)} + ${buyPct}% and selling ${naira(sellFlat)} + ${sellPct}%, from the next purchase and sale. Save the fees?`,
      { title: "Change the fees", confirmLabel: "Save fees" },
    );
    if (!ok) return;
    setBusy(true);
    const { error } = await supabase.rpc("set_bundle_fee_settings", payload);
    setBusy(false);
    if (error) {
      toast.error(error.message || "Couldn't save the fees");
      return;
    }
    toast.success("Fees saved");
    void load();
  };

  const field = (id: keyof FeeInputs, label: string, hint: string) => (
    <div className="space-y-2">
      <Label htmlFor={`fee-${id}`}>{label}</Label>
      <Input
        id={`fee-${id}`}
        inputMode="decimal"
        value={fees[id]}
        onChange={(e) => setFees((prev) => ({ ...prev, [id]: e.target.value }))}
        disabled={busy}
      />
      <p className="text-xs text-muted-foreground">{hint}</p>
    </div>
  );

  const example = (bundles: number, pct: number, flat: number, selling: boolean) => {
    if (!valid || bundles <= 0) return null;
    const fee = feeOn(bundles, pct, flat);
    return selling
      ? `Selling ${count(bundles)} bundles: fee ${naira(fee)}, the seller receives ${naira(Math.max(bundles - fee, 0))}.`
      : `Buying ${count(bundles)} bundles: fee ${naira(fee)}, the buyer pays ${naira(bundles + fee)}.`;
  };

  return (
    <Card className="bg-card border-border">
      <CardHeader>
        <CardTitle className="text-lg flex items-center gap-2">
          <Percent className="w-5 h-5 text-muted-foreground" />
          Buying and selling fees
        </CardTitle>
        <CardDescription>
          What people pay on top when they buy bundles, and what is taken off when they sell them back. Each fee is a
          flat amount plus a percentage of the value. Sharing, spraying and giveaways carry no fee.
        </CardDescription>
      </CardHeader>
      <CardContent className="space-y-5">
        <div>
          <p className="font-medium mb-2">Buying bundles</p>
          <div className="grid gap-4 sm:grid-cols-2">
            {field("buyFlat", "Flat fee (₦)", "Added to every purchase.")}
            {field("buyPercent", "Percentage fee (%)", "Of the value bought. 0 for none.")}
          </div>
          <p className="text-sm text-muted-foreground mt-2">{example(minPurchase, buyPct, buyFlat, false)}</p>
        </div>
        <div>
          <p className="font-medium mb-2">Selling bundles back</p>
          <div className="grid gap-4 sm:grid-cols-2">
            {field("sellFlat", "Flat fee (₦)", "Taken from every sale.")}
            {field("sellPercent", "Percentage fee (%)", "Of the value sold. 0 for none.")}
          </div>
          <p className="text-sm text-muted-foreground mt-2">{example(minSell, sellPct, sellFlat, true)}</p>
          {tooHigh && (
            <p className="text-sm text-destructive mt-1">
              This fee would take all of the smallest sale ({count(minSell)} bundles). Lower it, or raise the smallest sale.
            </p>
          )}
        </div>
        <Button onClick={save} disabled={busy || !changed}>
          {busy ? <Loader2 className="w-4 h-4 mr-2 animate-spin" /> : null}
          Save fees
        </Button>
      </CardContent>
    </Card>
  );
}
