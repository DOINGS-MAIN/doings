import { Link } from "react-router-dom";
import {
  Activity,
  AlertTriangle,
  ArrowDownLeft,
  ArrowUpRight,
  Clock,
  Loader2,
  RefreshCw,
  Webhook,
} from "lucide-react";
import { formatDistanceToNow } from "date-fns";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { useAdminPaymentsOverview } from "@/hooks/admin/useAdminQueries";

function formatNgnFromDisplay(naira: number) {
  return new Intl.NumberFormat("en-NG", {
    style: "currency",
    currency: "NGN",
    minimumFractionDigits: 0,
  }).format(naira);
}

export const AdminPaymentsOverview = () => {
  const { data: overview, isLoading, isFetching: overviewLoading, refetch } = useAdminPaymentsOverview();
  const fetchOverview = () => void refetch();

  if (isLoading || !overview) {
    return (
      <div className="p-8 flex items-center justify-center text-muted-foreground">
        <Loader2 className="w-5 h-5 animate-spin mr-2" />
        Loading payments overview…
      </div>
    );
  }

  const data = overview;
  const usd = (n: number) => new Intl.NumberFormat("en-US", { style: "currency", currency: "USD", minimumFractionDigits: 2 }).format(n);
  const money = (n: number, currency: string) => (currency === "USDC" ? usd(n) : formatNgnFromDisplay(n));

  return (
    <div className="p-8 space-y-8">
      <div className="flex items-start justify-between gap-4">
        <div>
          <h1 className="text-3xl font-bold text-foreground">Payments Overview</h1>
          <p className="text-muted-foreground mt-1">Money flows, payouts, bundle orders, treasury and webhooks</p>
        </div>
        <Button variant="outline" onClick={fetchOverview} disabled={overviewLoading}>
          <RefreshCw className={`w-4 h-4 mr-2 ${overviewLoading ? "animate-spin" : ""}`} />
          Refresh
        </Button>
      </div>

      {data.providerHealth.some((h) => !h.ok) && (
        <Card className="border-destructive/30 bg-destructive/5">
          <CardContent className="pt-6">
            <p className="font-medium text-destructive mb-2">Provider health alerts</p>
            <div className="space-y-1 text-sm">
              {data.providerHealth.filter((h) => !h.ok).map((h) => (
                <p key={h.providerId}>
                  <span className="font-medium capitalize">{h.providerId}</span>: {h.message}
                </p>
              ))}
            </div>
            <Button variant="outline" size="sm" className="mt-3" asChild>
              <Link to="/admin/payment-rails">Run health checks</Link>
            </Button>
          </CardContent>
        </Card>
      )}

      <div className="grid gap-4 md:grid-cols-2 lg:grid-cols-4">
        <Card>
          <CardContent className="pt-6">
            <div className="flex items-center gap-3">
              <div className="w-10 h-10 rounded-xl bg-success/10 flex items-center justify-center">
                <ArrowDownLeft className="w-5 h-5 text-success" />
              </div>
              <div>
                <p className="text-sm text-muted-foreground">Deposits today</p>
                <p className="text-xl font-bold">{formatNgnFromDisplay(data.today.deposits.volumeKobo / 100)}</p>
                <p className="text-xs text-muted-foreground">{data.today.deposits.count} txns</p>
              </div>
            </div>
          </CardContent>
        </Card>
        <Card>
          <CardContent className="pt-6">
            <div className="flex items-center gap-3">
              <div className="w-10 h-10 rounded-xl bg-accent/10 flex items-center justify-center">
                <ArrowUpRight className="w-5 h-5 text-accent" />
              </div>
              <div>
                <p className="text-sm text-muted-foreground">Withdrawals today</p>
                <p className="text-xl font-bold">{formatNgnFromDisplay(data.today.withdrawals.volumeKobo / 100)}</p>
                <p className="text-xs text-muted-foreground">{data.today.withdrawals.count} txns</p>
              </div>
            </div>
          </CardContent>
        </Card>
        <Card>
          <CardContent className="pt-6">
            <div className="flex items-center gap-3">
              <div className="w-10 h-10 rounded-xl bg-primary/10 flex items-center justify-center">
                <Clock className="w-5 h-5 text-primary" />
              </div>
              <div>
                <p className="text-sm text-muted-foreground">In-flight withdrawals</p>
                <p className="text-xl font-bold">
                  {data.queues.pendingWithdrawals + data.queues.processingWithdrawals}
                </p>
                <p className="text-xs text-muted-foreground">
                  {data.queues.pendingWithdrawals} pending · {data.queues.processingWithdrawals} processing
                </p>
                <Link to="/admin/queue" className="text-xs text-primary hover:underline">
                  Review queue →
                </Link>
              </div>
            </div>
          </CardContent>
        </Card>
        <Card>
          <CardContent className="pt-6">
            <div className="flex items-center gap-3">
              <div className="w-10 h-10 rounded-xl bg-destructive/10 flex items-center justify-center">
                <Webhook className="w-5 h-5 text-destructive" />
              </div>
              <div>
                <p className="text-sm text-muted-foreground">Unprocessed webhooks</p>
                <p className="text-xl font-bold text-destructive">{data.queues.unprocessedWebhooks}</p>
                <Link to="/admin/webhooks?processed=false" className="text-xs text-primary hover:underline">
                  View queue →
                </Link>
              </div>
            </div>
          </CardContent>
        </Card>
      </div>

      <div className="grid gap-6 lg:grid-cols-2">
        <Card>
          <CardHeader>
            <CardTitle className="text-lg flex items-center gap-2">
              <Activity className="w-5 h-5" />
              Active rails
            </CardTitle>
          </CardHeader>
          <CardContent className="space-y-3 text-sm">
            <div className="flex justify-between p-3 rounded-lg bg-muted/30">
              <span className="text-muted-foreground">Wallet funding</span>
              <Badge variant="outline" className="capitalize">{data.platform.walletFundingProviderId}</Badge>
            </div>
            <div className="flex justify-between p-3 rounded-lg bg-muted/30">
              <span className="text-muted-foreground">Disbursement</span>
              <Badge variant="outline" className="capitalize">{data.platform.disbursementProviderId}</Badge>
            </div>
            <div className="flex justify-between p-3 rounded-lg bg-muted/30">
              <span className="text-muted-foreground">PSP environment</span>
              <Badge className={data.platform.pspEnv === "production" ? "bg-amber-500/20 text-amber-700" : ""}>
                {data.platform.pspEnv}
              </Badge>
            </div>
            <Button variant="outline" size="sm" asChild>
              <Link to="/admin/payment-rails">Manage payment rails</Link>
            </Button>
          </CardContent>
        </Card>

        <Card>
          <CardHeader>
            <CardTitle className="text-lg">Volume by provider (today)</CardTitle>
          </CardHeader>
          <CardContent>
            {data.byProvider.length === 0 ? (
              <p className="text-sm text-muted-foreground">No payment activity today.</p>
            ) : (
              <div className="space-y-2">
                {data.byProvider.map((row) => (
                  <div key={row.provider} className="flex items-center justify-between p-3 rounded-lg bg-muted/30 text-sm">
                    <span className="font-medium capitalize">{row.provider}</span>
                    <div className="text-right text-xs text-muted-foreground">
                      <p>In: {formatNgnFromDisplay(row.deposits / 100)}</p>
                      <p>Out: {formatNgnFromDisplay(row.withdrawals / 100)}</p>
                    </div>
                  </div>
                ))}
              </div>
            )}
          </CardContent>
        </Card>
      </div>

      <Card>
        <CardHeader>
          <CardTitle className="text-lg flex items-center gap-2">
            <AlertTriangle className="w-5 h-5 text-destructive" />
            Recent failures
            <Badge variant="outline" className="ml-auto">{data.queues.failed24h} in 24h</Badge>
          </CardTitle>
        </CardHeader>
        <CardContent>
          {data.recentFailures.length === 0 ? (
            <p className="text-sm text-muted-foreground">No recent failed deposits or withdrawals.</p>
          ) : (
            <div className="space-y-2">
              {data.recentFailures.map((row) => (
                <Link
                  key={row.id}
                  to={`/admin/transactions/${row.id}`}
                  className="flex items-center justify-between p-3 rounded-lg border border-border hover:bg-muted/30 transition-colors"
                >
                  <div>
                    <p className="font-medium capitalize">{row.type} · {row.userName}</p>
                    <p className="text-xs font-mono text-muted-foreground">{row.reference}</p>
                  </div>
                  <div className="text-right">
                    <p className="font-semibold">
                      {row.currency === "NGN" ? formatNgnFromDisplay(row.amount) : `$${row.amount}`}
                    </p>
                    <p className="text-xs text-muted-foreground">
                      {formatDistanceToNow(row.createdAt, { addSuffix: true })}
                    </p>
                  </div>
                </Link>
              ))}
            </div>
          )}
        </CardContent>
      </Card>
      <div className="grid gap-4 md:grid-cols-3">
        <Link to="/admin/payouts?needs_review=1" className="rounded-xl border border-border p-4 hover:bg-muted/30 transition-colors">
          <p className="text-sm text-muted-foreground">Payouts needing review</p>
          <p className="text-2xl font-bold">{data.money.queue.payoutsNeedingReview}</p>
        </Link>
        <Link to="/admin/bundle-orders?needs_refund=1" className="rounded-xl border border-border p-4 hover:bg-muted/30 transition-colors">
          <p className="text-sm text-muted-foreground">Paid but failed orders</p>
          <p className="text-2xl font-bold">{data.money.queue.ordersPaidFailed}</p>
        </Link>
        <Link to="/admin/bundle-orders?status=pending_float" className="rounded-xl border border-border p-4 hover:bg-muted/30 transition-colors">
          <p className="text-sm text-muted-foreground">Waiting for USDC float</p>
          <p className="text-2xl font-bold">{data.money.queue.ordersPendingFloat}</p>
        </Link>
      </div>

      <Card>
        <CardHeader>
          <CardTitle className="text-lg">Money flows (completed)</CardTitle>
        </CardHeader>
        <CardContent>
          {data.money.byType.length === 0 ? (
            <p className="text-sm text-muted-foreground">No completed transactions in the last 7 days.</p>
          ) : (
            <div className="overflow-x-auto">
              <table className="w-full text-sm">
                <thead>
                  <tr className="text-left text-muted-foreground">
                    <th className="py-2 pr-4 font-medium">Type</th>
                    <th className="py-2 pr-4 font-medium">Currency</th>
                    <th className="py-2 pr-4 font-medium text-right">Today</th>
                    <th className="py-2 pr-4 font-medium text-right">Today amount</th>
                    <th className="py-2 pr-4 font-medium text-right">7 days</th>
                    <th className="py-2 font-medium text-right">7-day amount</th>
                  </tr>
                </thead>
                <tbody>
                  {data.money.byType.map((r) => (
                    <tr key={`${r.type}-${r.currency}`} className="border-t border-border">
                      <td className="py-2 pr-4 capitalize">{r.type.replace(/_/g, " ")}</td>
                      <td className="py-2 pr-4">{r.currency}</td>
                      <td className="py-2 pr-4 text-right">{r.countToday}</td>
                      <td className="py-2 pr-4 text-right">{money(r.amountToday, r.currency)}</td>
                      <td className="py-2 pr-4 text-right">{r.count7d}</td>
                      <td className="py-2 text-right">{money(r.amount7d, r.currency)}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          )}
        </CardContent>
      </Card>

      <Card>
        <CardHeader>
          <CardTitle className="text-lg">Treasury</CardTitle>
        </CardHeader>
        <CardContent className="space-y-4">
          <div className="flex flex-wrap gap-6">
            {data.money.treasury.length === 0 ? (
              <p className="text-sm text-muted-foreground">No treasury wallets found.</p>
            ) : (
              data.money.treasury.map((w) => (
                <div key={w.currency}>
                  <p className="text-sm text-muted-foreground">{w.currency}</p>
                  <p className="text-xl font-bold">{money(w.balance, w.currency)}</p>
                  {w.locked > 0 && <p className="text-xs text-muted-foreground">{money(w.locked, w.currency)} held</p>}
                </div>
              ))
            )}
          </div>
          <div>
            <p className="text-sm font-medium mb-2">Recent top-ups</p>
            {data.money.recentTopups.length === 0 ? (
              <p className="text-sm text-muted-foreground">No top-ups recorded. Record them on the FX page.</p>
            ) : (
              <div className="space-y-1">
                {data.money.recentTopups.map((t) => (
                  <div key={t.id} className="flex items-center justify-between text-sm border-b border-border last:border-0 py-1.5">
                    <span>
                      {money(t.amount, t.currency)}
                      {t.reference && <span className="ml-2 font-mono text-xs text-muted-foreground">{t.reference}</span>}
                      {t.note && <span className="ml-2 text-muted-foreground">{t.note}</span>}
                    </span>
                    <span className="text-xs text-muted-foreground">{formatDistanceToNow(t.createdAt, { addSuffix: true })}</span>
                  </div>
                ))}
              </div>
            )}
          </div>
        </CardContent>
      </Card>
    </div>
  );
};
