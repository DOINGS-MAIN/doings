import { useEffect, useState } from "react";
import { Navigate } from "react-router-dom";
import {
  ArrowLeftRight,
  Loader2,
  RefreshCw,
  Wallet,
  TrendingUp,
  Percent,
} from "lucide-react";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Switch } from "@/components/ui/switch";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { useFxSettings } from "@/hooks/useFxSettings";
import { useAdminAuth } from "@/hooks/useAdminAuth";
import { ROLE_PERMISSIONS } from "@/types/admin";
import { toast } from "sonner";
import { formatDistanceToNow } from "date-fns";

function canAccessFx(role: string) {
  const permissions = ROLE_PERMISSIONS[role as keyof typeof ROLE_PERMISSIONS] ?? [];
  return permissions.includes("*") || permissions.includes("payment_rails");
}

export const AdminFxSettings = () => {
  const { currentAccount } = useAdminAuth();
  const {
    settings,
    treasury,
    loading,
    saving,
    refreshingRate,
    saveSettings,
    refreshMarketRate,
    setManualMarketRate,
    recordTopup,
    refresh,
  } = useFxSettings();

  const [enabled, setEnabled] = useState(false);
  const [rateSource, setRateSource] = useState<"binance" | "bybit" | "paycrest" | "manual">("binance");
  const [sellFlat, setSellFlat] = useState("0");
  const [sellPercent, setSellPercent] = useState("0");
  const [buyFlat, setBuyFlat] = useState("0");
  const [buyPercent, setBuyPercent] = useState("0");
  const [sellFee, setSellFee] = useState("0");
  const [buyFee, setBuyFee] = useState("0");
  const [dailyCap, setDailyCap] = useState("10000");
  const [minTrade, setMinTrade] = useState("5");
  const [quoteTtl, setQuoteTtl] = useState("60");
  const [manualRate, setManualRate] = useState("");

  const [topupCurrency, setTopupCurrency] = useState<"NGN" | "USDC">("NGN");
  const [topupAmount, setTopupAmount] = useState("");
  const [topupRef, setTopupRef] = useState("");
  const [topupNote, setTopupNote] = useState("");

  useEffect(() => {
    if (!settings) return;
    setEnabled(settings.enabled);
    setRateSource(settings.rate_source);
    setSellFlat(String(settings.sell_flat_naira ?? 0));
    setSellPercent(String(settings.sell_percent ?? 0));
    setBuyFlat(String(settings.buy_flat_naira ?? 0));
    setBuyPercent(String(settings.buy_percent ?? 0));
    setSellFee(String(settings.sell_platform_fee_percent ?? 0));
    setBuyFee(String(settings.buy_platform_fee_percent ?? 0));
    setDailyCap(String(settings.daily_cap_usdc ?? 10000));
    setMinTrade(String(settings.min_trade_usdc ?? 5));
    setQuoteTtl(String(settings.quote_ttl_seconds ?? 60));
    if (settings.market_rate_naira) setManualRate(String(settings.market_rate_naira));
  }, [settings]);

  if (!currentAccount || !canAccessFx(currentAccount.role)) {
    return <Navigate to="/admin" replace />;
  }

  const handleSave = async () => {
    try {
      await saveSettings({
        enabled,
        rateSource,
        sellFlatNaira: parseFloat(sellFlat) || 0,
        sellPercent: parseFloat(sellPercent) || 0,
        buyFlatNaira: parseFloat(buyFlat) || 0,
        buyPercent: parseFloat(buyPercent) || 0,
        sellPlatformFeePercent: parseFloat(sellFee) || 0,
        buyPlatformFeePercent: parseFloat(buyFee) || 0,
        dailyCapUsdc: parseFloat(dailyCap) || 10000,
        minTradeUsdc: parseFloat(minTrade) || 5,
        quoteTtlSeconds: parseInt(quoteTtl, 10) || 60,
      });
      toast.success("FX settings saved");
    } catch (err) {
      toast.error(err instanceof Error ? err.message : "Failed to save");
    }
  };

  const handleRefreshRate = async () => {
    try {
      await refreshMarketRate();
      toast.success("Market rate refreshed from P2P (Binance → Bybit fallback)");
    } catch (err) {
      toast.error(err instanceof Error ? err.message : "Rate refresh failed");
    }
  };

  const handleSetManualRate = async () => {
    const naira = parseFloat(manualRate);
    if (!naira || naira <= 0) {
      toast.error("Enter a positive ₦/USDC market rate");
      return;
    }
    try {
      await setManualMarketRate(naira);
      setRateSource("manual");
      toast.success(`Manual market rate set to ₦${naira.toLocaleString()}`);
    } catch (err) {
      toast.error(err instanceof Error ? err.message : "Failed to set rate");
    }
  };

  const handleTopup = async () => {
    const amt = parseFloat(topupAmount);
    if (!amt || amt <= 0) {
      toast.error("Enter a valid amount");
      return;
    }
    try {
      await recordTopup(topupCurrency, amt, topupRef || undefined, topupNote || undefined);
      toast.success(`Treasury ${topupCurrency} credited`);
      setTopupAmount("");
      setTopupRef("");
      setTopupNote("");
    } catch (err) {
      toast.error(err instanceof Error ? err.message : "Top-up failed");
    }
  };

  if (loading && !settings) {
    return (
      <div className="flex items-center justify-center py-24">
        <Loader2 className="w-8 h-8 animate-spin text-muted-foreground" />
      </div>
    );
  }

  return (
    <div className="space-y-6 p-6 max-w-4xl">
      <div className="flex items-center justify-between">
        <div>
          <h1 className="text-2xl font-bold flex items-center gap-2">
            <ArrowLeftRight className="w-6 h-6" />
            FX & Conversion
          </h1>
          <p className="text-muted-foreground text-sm mt-1">
            USDC↔NGN rates, spreads, treasury float, and conversion limits
          </p>
        </div>
        <Button variant="outline" size="sm" onClick={() => void refresh()} disabled={loading}>
          <RefreshCw className={`w-4 h-4 mr-2 ${loading ? "animate-spin" : ""}`} />
          Reload
        </Button>
      </div>

      <Card>
        <CardHeader>
          <CardTitle className="flex items-center gap-2">
            <TrendingUp className="w-5 h-5" />
            Market rate
          </CardTitle>
          <CardDescription>
            Base ₦ per USDC before spreads. Auto refresh tries Binance P2P, then Bybit USDT/NGN
            (Binance NGN P2P has been suspended). Or set a manual rate.
          </CardDescription>
        </CardHeader>
        <CardContent className="space-y-4">
          <div className="grid grid-cols-1 sm:grid-cols-3 gap-4">
            <div className="rounded-xl bg-muted/50 p-4">
              <p className="text-xs text-muted-foreground">Market</p>
              <p className="text-2xl font-bold">
                {settings?.market_rate_naira
                  ? `₦${settings.market_rate_naira.toLocaleString()}`
                  : "—"}
              </p>
              {settings?.market_rate_updated_at && (
                <p className="text-xs text-muted-foreground mt-1">
                  {formatDistanceToNow(new Date(settings.market_rate_updated_at), { addSuffix: true })}
                </p>
              )}
              {settings?.rate_source && (
                <p className="text-xs text-muted-foreground mt-0.5 capitalize">Source: {settings.rate_source}</p>
              )}
            </div>
            <div className="rounded-xl bg-muted/50 p-4">
              <p className="text-xs text-muted-foreground">Effective sell rate</p>
              <p className="text-2xl font-bold text-emerald-600">
                {settings?.sell_rate_naira
                  ? `₦${settings.sell_rate_naira.toLocaleString()}`
                  : "—"}
              </p>
            </div>
            <div className="rounded-xl bg-muted/50 p-4">
              <p className="text-xs text-muted-foreground">Effective buy rate</p>
              <p className="text-2xl font-bold text-amber-600">
                {settings?.buy_rate_naira
                  ? `₦${settings.buy_rate_naira.toLocaleString()}`
                  : "—"}
              </p>
            </div>
          </div>
          <div className="flex flex-col sm:flex-row gap-3 sm:items-end">
            <Button onClick={() => void handleRefreshRate()} disabled={refreshingRate}>
              {refreshingRate ? (
                <Loader2 className="w-4 h-4 mr-2 animate-spin" />
              ) : (
                <RefreshCw className="w-4 h-4 mr-2" />
              )}
              Refresh from P2P
            </Button>
            <div className="flex-1 space-y-1">
              <Label className="text-xs">Manual ₦ / USDC</Label>
              <div className="flex gap-2">
                <Input
                  value={manualRate}
                  onChange={(e) => setManualRate(e.target.value.replace(/[^0-9.]/g, ""))}
                  placeholder="e.g. 1580"
                />
                <Button variant="secondary" onClick={() => void handleSetManualRate()} disabled={refreshingRate}>
                  Set manual
                </Button>
              </div>
            </div>
          </div>
        </CardContent>
      </Card>

      <Card>
        <CardHeader>
          <CardTitle>Conversion settings</CardTitle>
        </CardHeader>
        <CardContent className="space-y-6">
          <div className="flex items-center justify-between">
            <div>
              <Label>Enable convert</Label>
              <p className="text-xs text-muted-foreground">Users can buy/sell USDC in-app</p>
            </div>
            <Switch checked={enabled} onCheckedChange={setEnabled} />
          </div>

          <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
            <div>
              <Label>Rate source</Label>
              <Select value={rateSource} onValueChange={(v) => setRateSource(v as typeof rateSource)}>
                <SelectTrigger className="mt-1">
                  <SelectValue />
                </SelectTrigger>
                <SelectContent>
                  <SelectItem value="binance">Auto P2P (Binance → Bybit)</SelectItem>
                  <SelectItem value="bybit">Bybit P2P</SelectItem>
                  <SelectItem value="manual">Manual</SelectItem>
                  <SelectItem value="paycrest" disabled>Paycrest (coming soon)</SelectItem>
                </SelectContent>
              </Select>
            </div>
            <div>
              <Label>Quote lock (seconds)</Label>
              <Input className="mt-1" value={quoteTtl} onChange={(e) => setQuoteTtl(e.target.value)} />
            </div>
          </div>

          <div className="grid grid-cols-1 sm:grid-cols-2 gap-6">
            <div className="space-y-3 rounded-xl border p-4">
              <p className="font-semibold text-sm">Sell spread (user sells USDC)</p>
              <div>
                <Label className="text-xs">Flat ₦ off market</Label>
                <Input className="mt-1" value={sellFlat} onChange={(e) => setSellFlat(e.target.value)} />
              </div>
              <div>
                <Label className="text-xs">% off market</Label>
                <Input className="mt-1" value={sellPercent} onChange={(e) => setSellPercent(e.target.value)} />
              </div>
              <div>
                <Label className="text-xs flex items-center gap-1">
                  <Percent className="w-3 h-3" /> Platform fee on sell
                </Label>
                <Input className="mt-1" value={sellFee} onChange={(e) => setSellFee(e.target.value)} />
              </div>
            </div>
            <div className="space-y-3 rounded-xl border p-4">
              <p className="font-semibold text-sm">Buy spread (user buys USDC)</p>
              <div>
                <Label className="text-xs">Flat ₦ on market</Label>
                <Input className="mt-1" value={buyFlat} onChange={(e) => setBuyFlat(e.target.value)} />
              </div>
              <div>
                <Label className="text-xs">% on market</Label>
                <Input className="mt-1" value={buyPercent} onChange={(e) => setBuyPercent(e.target.value)} />
              </div>
              <div>
                <Label className="text-xs flex items-center gap-1">
                  <Percent className="w-3 h-3" /> Platform fee on buy
                </Label>
                <Input className="mt-1" value={buyFee} onChange={(e) => setBuyFee(e.target.value)} />
              </div>
            </div>
          </div>

          <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
            <div>
              <Label>Daily cap per user (USDC)</Label>
              <Input className="mt-1" value={dailyCap} onChange={(e) => setDailyCap(e.target.value)} />
            </div>
            <div>
              <Label>Min trade (USDC)</Label>
              <Input className="mt-1" value={minTrade} onChange={(e) => setMinTrade(e.target.value)} />
            </div>
          </div>

          <Button onClick={() => void handleSave()} disabled={saving}>
            {saving && <Loader2 className="w-4 h-4 mr-2 animate-spin" />}
            Save settings
          </Button>
        </CardContent>
      </Card>

      <Card>
        <CardHeader>
          <CardTitle className="flex items-center gap-2">
            <Wallet className="w-5 h-5" />
            Treasury float
          </CardTitle>
          <CardDescription>
            Ledger balances for in-app conversions. Ops records top-ups when real funds are moved in.
          </CardDescription>
        </CardHeader>
        <CardContent className="space-y-6">
          <div className="grid grid-cols-2 gap-4">
            <div className="rounded-xl bg-muted/50 p-4">
              <p className="text-xs text-muted-foreground">NGN float</p>
              <p className="text-xl font-bold">
                ₦{(treasury?.ngn_balance_naira ?? 0).toLocaleString()}
              </p>
            </div>
            <div className="rounded-xl bg-muted/50 p-4">
              <p className="text-xs text-muted-foreground">USDC float</p>
              <p className="text-xl font-bold">
                ${(treasury?.usdc_balance ?? 0).toLocaleString(undefined, { minimumFractionDigits: 2 })}
              </p>
            </div>
          </div>

          <div className="rounded-xl border p-4 space-y-3">
            <p className="font-semibold text-sm">Record treasury top-up</p>
            <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
              <div>
                <Label>Currency</Label>
                <Select value={topupCurrency} onValueChange={(v) => setTopupCurrency(v as "NGN" | "USDC")}>
                  <SelectTrigger className="mt-1">
                    <SelectValue />
                  </SelectTrigger>
                  <SelectContent>
                    <SelectItem value="NGN">NGN</SelectItem>
                    <SelectItem value="USDC">USDC</SelectItem>
                  </SelectContent>
                </Select>
              </div>
              <div>
                <Label>Amount</Label>
                <Input
                  className="mt-1"
                  value={topupAmount}
                  onChange={(e) => setTopupAmount(e.target.value)}
                  placeholder={topupCurrency === "NGN" ? "500000" : "1000"}
                />
              </div>
              <div>
                <Label>Reference (optional)</Label>
                <Input className="mt-1" value={topupRef} onChange={(e) => setTopupRef(e.target.value)} />
              </div>
              <div>
                <Label>Note (optional)</Label>
                <Input className="mt-1" value={topupNote} onChange={(e) => setTopupNote(e.target.value)} />
              </div>
            </div>
            <Button variant="secondary" onClick={() => void handleTopup()} disabled={saving}>
              Record top-up
            </Button>
          </div>
        </CardContent>
      </Card>
    </div>
  );
};
