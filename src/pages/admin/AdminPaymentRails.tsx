import { useMemo, useState, useEffect } from "react";
import { Navigate } from "react-router-dom";
import {
  Route,
  RefreshCw,
  Wallet,
  ArrowUpRight,
  Globe,
  AlertTriangle,
  CheckCircle2,
  XCircle,
  Loader2,
  Percent,
} from "lucide-react";
import { formatDistanceToNow } from "date-fns";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
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
import { usePaymentRails } from "@/hooks/usePaymentRails";
import { useAdminAuth } from "@/hooks/useAdminAuth";
import { ROLE_PERMISSIONS, type PspProvider } from "@/types/admin";
import { toast } from "sonner";

const CAPABILITY_LABELS: Record<string, string> = {
  wallet_funding: "Wallet funding",
  disbursement: "Disbursement",
  bank_verify: "Bank verify",
};

function statusBadge(status: PspProvider["status"]) {
  switch (status) {
    case "active":
      return <Badge className="bg-success/20 text-success border-0">Active</Badge>;
    case "sandbox_only":
      return <Badge className="bg-amber-500/20 text-amber-600 border-0">Sandbox only</Badge>;
    case "disabled":
      return <Badge variant="destructive">Disabled</Badge>;
  }
}

function canAccessPaymentRails(role: string) {
  const permissions = ROLE_PERMISSIONS[role as keyof typeof ROLE_PERMISSIONS] ?? [];
  return permissions.includes("*") || permissions.includes("payment_rails");
}

export const AdminPaymentRails = () => {
  const { currentAccount } = useAdminAuth();
  const {
    providers,
    settings,
    loading,
    saving,
    healthByProvider,
    healthLoading,
    refresh,
    setFundingProvider,
    setDisbursementProvider,
    setPspEnv,
    probeHealth,
    probeAll,
    withdrawalFees,
    withdrawalFeesLoading,
    fetchWithdrawalFees,
    setWithdrawalFees,
  } = usePaymentRails();

  const [pendingEnv, setPendingEnv] = useState<"sandbox" | "production" | null>(null);
  const [platformFeeInput, setPlatformFeeInput] = useState("0");
  const [transactionFeeInput, setTransactionFeeInput] = useState("50");

  const isSuperAdmin = currentAccount?.role === "super_admin";

  useEffect(() => {
    if (isSuperAdmin) {
      void fetchWithdrawalFees();
    }
  }, [isSuperAdmin, fetchWithdrawalFees]);

  useEffect(() => {
    setPlatformFeeInput(String(withdrawalFees.platformFeePercent));
    setTransactionFeeInput(String(withdrawalFees.transactionFeeNaira));
  }, [withdrawalFees]);

  const fundingProviders = useMemo(
    () => providers.filter((p) => p.status !== "disabled" && p.capabilities.includes("wallet_funding")),
    [providers]
  );

  const disbursementProviders = useMemo(
    () => providers.filter((p) => p.status !== "disabled" && p.capabilities.includes("disbursement")),
    [providers]
  );

  if (!currentAccount || !canAccessPaymentRails(currentAccount.role)) {
    return <Navigate to="/admin" replace />;
  }

  const handleFundingChange = async (providerId: string) => {
    if (!settings || providerId === settings.walletFundingProviderId) return;
    try {
      await setFundingProvider(providerId);
      toast.success("Wallet funding provider updated");
    } catch (err) {
      toast.error(err instanceof Error ? err.message : "Failed to update funding provider");
    }
  };

  const handleDisbursementChange = async (providerId: string) => {
    if (!settings || providerId === settings.disbursementProviderId) return;
    try {
      await setDisbursementProvider(providerId);
      toast.success("Disbursement provider updated");
    } catch (err) {
      toast.error(err instanceof Error ? err.message : "Failed to update disbursement provider");
    }
  };

  const confirmEnvChange = async () => {
    if (!pendingEnv) return;
    try {
      await setPspEnv(pendingEnv);
      toast.success(`PSP environment set to ${pendingEnv}`);
    } catch (err) {
      toast.error(err instanceof Error ? err.message : "Failed to update environment");
    } finally {
      setPendingEnv(null);
    }
  };

  const handleProbeAll = async () => {
    try {
      await probeAll();
      toast.success("Health checks completed");
    } catch (err) {
      toast.error(err instanceof Error ? err.message : "Health check failed");
    }
  };

  const handleSaveWithdrawalFees = async () => {
    const platformFeePercent = Number(platformFeeInput);
    const transactionFeeNaira = Number(transactionFeeInput);

    if (!Number.isFinite(platformFeePercent) || platformFeePercent < 0 || platformFeePercent > 100) {
      toast.error("Platform fee must be between 0 and 100%");
      return;
    }
    if (!Number.isFinite(transactionFeeNaira) || transactionFeeNaira < 0) {
      toast.error("Transaction fee cannot be negative");
      return;
    }

    try {
      await setWithdrawalFees(platformFeePercent, transactionFeeNaira);
      toast.success("Withdrawal fees updated");
    } catch (err) {
      toast.error(err instanceof Error ? err.message : "Failed to update withdrawal fees");
    }
  };

  const providerName = (id: string) => providers.find((p) => p.id === id)?.displayName ?? id;

  return (
    <div className="p-8 space-y-8">
      <div className="flex items-start justify-between gap-4">
        <div>
          <h1 className="text-3xl font-bold text-foreground">Payment Rails</h1>
          <p className="text-muted-foreground mt-1">
            Control wallet funding and disbursement providers independently
          </p>
        </div>
        <div className="flex gap-2">
          <Button variant="outline" onClick={handleProbeAll} disabled={loading || saving}>
            Run all health checks
          </Button>
          <Button variant="outline" onClick={refresh} disabled={loading || saving}>
          <RefreshCw className={`w-4 h-4 mr-2 ${loading ? "animate-spin" : ""}`} />
          Refresh
        </Button>
        </div>
      </div>

      <Card className="border-amber-500/30 bg-amber-500/5">
        <CardContent className="pt-6 flex gap-3">
          <AlertTriangle className="w-5 h-5 text-amber-600 shrink-0 mt-0.5" />
          <div className="text-sm text-muted-foreground">
            <p className="font-medium text-foreground">Changes apply to new operations only</p>
            <p className="mt-1">
              In-flight withdrawals keep the provider they were submitted with. Users who already have a reserved
              account keep it; new users get an account from the active funding provider.
            </p>
          </div>
        </CardContent>
      </Card>

      <div className="grid gap-6 lg:grid-cols-3">
        <Card className="bg-card border-border">
          <CardHeader>
            <CardTitle className="text-lg flex items-center gap-2">
              <Globe className="w-5 h-5 text-muted-foreground" />
              PSP Environment
            </CardTitle>
            <CardDescription>API environment for provider calls</CardDescription>
          </CardHeader>
          <CardContent className="space-y-4">
            <Select
              value={settings?.pspEnv ?? "sandbox"}
              onValueChange={(value) => {
                if (value === "production") {
                  setPendingEnv("production");
                } else {
                  setPspEnv("sandbox").then(() => toast.success("PSP environment set to sandbox")).catch((err) => {
                    toast.error(err instanceof Error ? err.message : "Failed to update environment");
                  });
                }
              }}
              disabled={loading || saving || !settings}
            >
              <SelectTrigger>
                <SelectValue />
              </SelectTrigger>
              <SelectContent>
                <SelectItem value="sandbox">Sandbox</SelectItem>
                <SelectItem value="production">Production</SelectItem>
              </SelectContent>
            </Select>
            {settings?.pspEnv === "production" && (
              <p className="text-xs text-amber-600">Live money — verify credentials and webhooks before routing traffic.</p>
            )}
          </CardContent>
        </Card>

        <Card className="bg-card border-border">
          <CardHeader>
            <CardTitle className="text-lg flex items-center gap-2">
              <Wallet className="w-5 h-5 text-muted-foreground" />
              Wallet Funding
            </CardTitle>
            <CardDescription>Virtual accounts for NGN deposits</CardDescription>
          </CardHeader>
          <CardContent className="space-y-3">
            <Select
              value={settings?.walletFundingProviderId ?? ""}
              onValueChange={handleFundingChange}
              disabled={loading || saving || !settings}
            >
              <SelectTrigger>
                <SelectValue placeholder="Select provider" />
              </SelectTrigger>
              <SelectContent>
                {fundingProviders.map((p) => (
                  <SelectItem key={p.id} value={p.id}>
                    {p.displayName}
                    {p.status === "sandbox_only" ? " (sandbox)" : ""}
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>
            {settings && (
              <p className="text-xs text-muted-foreground">
                Active: <span className="font-medium text-foreground">{providerName(settings.walletFundingProviderId)}</span>
              </p>
            )}
          </CardContent>
        </Card>

        <Card className="bg-card border-border">
          <CardHeader>
            <CardTitle className="text-lg flex items-center gap-2">
              <ArrowUpRight className="w-5 h-5 text-muted-foreground" />
              Disbursement
            </CardTitle>
            <CardDescription>Bank transfers and withdrawals</CardDescription>
          </CardHeader>
          <CardContent className="space-y-3">
            <Select
              value={settings?.disbursementProviderId ?? ""}
              onValueChange={handleDisbursementChange}
              disabled={loading || saving || !settings}
            >
              <SelectTrigger>
                <SelectValue placeholder="Select provider" />
              </SelectTrigger>
              <SelectContent>
                {disbursementProviders.map((p) => (
                  <SelectItem key={p.id} value={p.id}>
                    {p.displayName}
                    {p.status === "sandbox_only" ? " (sandbox)" : ""}
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>
            {settings && (
              <p className="text-xs text-muted-foreground">
                Active: <span className="font-medium text-foreground">{providerName(settings.disbursementProviderId)}</span>
              </p>
            )}
          </CardContent>
        </Card>
      </div>

      {isSuperAdmin && (
        <Card className="bg-card border-border">
          <CardHeader>
            <CardTitle className="text-lg flex items-center gap-2">
              <Percent className="w-5 h-5 text-muted-foreground" />
              NGN Withdrawal Fees
            </CardTitle>
            <CardDescription>
              Applies to bank withdrawals only — not in-app Send Money between users.
              Platform fee is a percentage of the withdrawal amount; transaction fee is a flat charge in naira.
            </CardDescription>
          </CardHeader>
          <CardContent className="space-y-4">
            <div className="grid gap-4 sm:grid-cols-2">
              <div className="space-y-2">
                <Label htmlFor="platform-fee-percent">Platform fee (%)</Label>
                <Input
                  id="platform-fee-percent"
                  type="number"
                  min={0}
                  max={100}
                  step={0.01}
                  value={platformFeeInput}
                  onChange={(e) => setPlatformFeeInput(e.target.value)}
                  disabled={withdrawalFeesLoading || saving}
                />
                <p className="text-xs text-muted-foreground">Example: 5 means 5% of the withdrawal amount.</p>
              </div>
              <div className="space-y-2">
                <Label htmlFor="transaction-fee-naira">Transaction fee (₦)</Label>
                <Input
                  id="transaction-fee-naira"
                  type="number"
                  min={0}
                  step={1}
                  value={transactionFeeInput}
                  onChange={(e) => setTransactionFeeInput(e.target.value)}
                  disabled={withdrawalFeesLoading || saving}
                />
                <p className="text-xs text-muted-foreground">Flat fee added on every NGN withdrawal.</p>
              </div>
            </div>
            <Button onClick={handleSaveWithdrawalFees} disabled={withdrawalFeesLoading || saving}>
              {saving ? <Loader2 className="w-4 h-4 mr-2 animate-spin" /> : null}
              Save withdrawal fees
            </Button>
          </CardContent>
        </Card>
      )}

      <Card className="bg-card border-border">
        <CardHeader>
          <CardTitle className="text-lg flex items-center gap-2">
            <Route className="w-5 h-5 text-muted-foreground" />
            Provider Catalog
          </CardTitle>
          <CardDescription>Registered PSPs and credential health</CardDescription>
        </CardHeader>
        <CardContent>
          {loading ? (
            <div className="flex items-center justify-center py-12 text-muted-foreground">
              <Loader2 className="w-5 h-5 animate-spin mr-2" />
              Loading providers…
            </div>
          ) : (
            <div className="space-y-3">
              {providers.map((provider) => {
                const health = healthByProvider[provider.id];
                const isChecking = healthLoading[provider.id];

                return (
                  <div
                    key={provider.id}
                    className="flex flex-col sm:flex-row sm:items-center gap-4 p-4 rounded-xl bg-muted/30 border border-border"
                  >
                    <div className="flex-1 min-w-0">
                      <div className="flex flex-wrap items-center gap-2">
                        <p className="font-semibold text-foreground">{provider.displayName}</p>
                        <Badge variant="outline" className="text-xs font-mono">{provider.id}</Badge>
                        {statusBadge(provider.status)}
                        {settings?.walletFundingProviderId === provider.id && (
                          <Badge className="bg-primary/20 text-primary border-0 text-xs">Funding</Badge>
                        )}
                        {settings?.disbursementProviderId === provider.id && (
                          <Badge className="bg-secondary/20 text-secondary-foreground border-0 text-xs">Disbursement</Badge>
                        )}
                      </div>
                      <div className="flex flex-wrap gap-1.5 mt-2">
                        {provider.capabilities.map((cap) => (
                          <Badge key={cap} variant="secondary" className="text-xs">
                            {CAPABILITY_LABELS[cap] ?? cap}
                          </Badge>
                        ))}
                      </div>
                      {provider.updatedAt && (
                        <p className="text-xs text-muted-foreground mt-2">
                          Updated {formatDistanceToNow(provider.updatedAt, { addSuffix: true })}
                        </p>
                      )}
                    </div>

                    <div className="flex items-center gap-3 shrink-0">
                      {health && (
                        <div className="flex items-center gap-1.5 text-sm">
                          {health.ok ? (
                            <CheckCircle2 className="w-4 h-4 text-success" />
                          ) : (
                            <XCircle className="w-4 h-4 text-destructive" />
                          )}
                          <span className={health.ok ? "text-success" : "text-destructive"}>{health.message}</span>
                        </div>
                      )}
                      <Button
                        variant="outline"
                        size="sm"
                        onClick={() => probeHealth(provider.id)}
                        disabled={isChecking}
                      >
                        {isChecking ? <Loader2 className="w-4 h-4 animate-spin" /> : "Check credentials"}
                      </Button>
                    </div>
                  </div>
                );
              })}
            </div>
          )}
        </CardContent>
      </Card>

      <AlertDialog open={pendingEnv === "production"} onOpenChange={(open) => !open && setPendingEnv(null)}>
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>Switch to production?</AlertDialogTitle>
            <AlertDialogDescription>
              This will route new PSP API calls to live endpoints. Confirm that production secrets and webhooks are
              configured for all active providers.
            </AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel>Cancel</AlertDialogCancel>
            <AlertDialogAction onClick={confirmEnvChange}>Enable production</AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>
    </div>
  );
};
