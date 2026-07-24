import { useEffect, useState } from "react";
import { Link, useNavigate, useParams } from "react-router-dom";
import {
  ArrowLeft,
  Flag,
  Loader2,
  ExternalLink,
  User,
} from "lucide-react";
import { format } from "date-fns";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from "@/components/ui/table";
import { PspTimeline } from "@/components/admin/PspTimeline";
import { useAdminMonitoring } from "@/hooks/useAdminMonitoring";
import type { AdminTransactionDetail } from "@/types/admin";
import { getCryptoTrackId, solanaExplorerTxUrl } from "@/lib/cryptoTx";
import { toast } from "sonner";
import { Copy } from "lucide-react";

function formatMoney(amount: number, currency: string) {
  if (currency === "USDC") {
    return new Intl.NumberFormat("en-US", { style: "currency", currency: "USD" }).format(Math.abs(amount));
  }
  return new Intl.NumberFormat("en-NG", { style: "currency", currency: "NGN", minimumFractionDigits: 0 }).format(Math.abs(amount));
}

export const AdminTransactionDetail = () => {
  const { txnId } = useParams<{ txnId: string }>();
  const navigate = useNavigate();
  const { fetchTransactionDetail } = useAdminMonitoring();
  const [detail, setDetail] = useState<AdminTransactionDetail | null>(null);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    if (!txnId) return;
    setLoading(true);
    fetchTransactionDetail(txnId)
      .then(setDetail)
      .finally(() => setLoading(false));
  }, [txnId, fetchTransactionDetail]);

  if (loading) {
    return (
      <div className="p-8 flex items-center justify-center text-muted-foreground">
        <Loader2 className="w-5 h-5 animate-spin mr-2" />
        Loading transaction…
      </div>
    );
  }

  if (!detail) {
    return (
      <div className="p-8 space-y-4">
        <Button variant="ghost" onClick={() => navigate("/admin/transactions")}>
          <ArrowLeft className="w-4 h-4 mr-2" />
          Back
        </Button>
        <p className="text-muted-foreground">Transaction not found.</p>
      </div>
    );
  }

  const { transaction: txn, ledgerEntries, pspEvents, relatedWebhooks } = detail;
  const feeBreakdown = txn.metadata?.fee_breakdown as {
    platform_fee_percent?: number;
    platform_fee_kobo?: number;
    transaction_fee_kobo?: number;
    total_fee_kobo?: number;
  } | undefined;

  const formatKobo = (kobo: number, currency: string) =>
    formatMoney(kobo / (currency === "USDC" ? 1_000_000 : 100), currency);

  return (
    <div className="p-8 space-y-6">
      <div className="flex items-center gap-4">
        <Button variant="ghost" size="sm" onClick={() => navigate("/admin/transactions")}>
          <ArrowLeft className="w-4 h-4 mr-2" />
          Transactions
        </Button>
      </div>

      <div className="flex flex-wrap items-start justify-between gap-4">
        <div>
          <h1 className="text-2xl font-bold text-foreground font-mono">{txn.reference}</h1>
          <p className="text-muted-foreground mt-1">{txn.description}</p>
        </div>
        <div className="flex flex-wrap gap-2">
          <Badge className="capitalize">{txn.type}</Badge>
          <Badge variant="outline" className="capitalize">{txn.status}</Badge>
          {txn.provider && <Badge variant="secondary" className="capitalize">{txn.provider}</Badge>}
          {txn.flagged && (
            <Badge variant="destructive" className="gap-1">
              <Flag className="w-3 h-3" />
              Flagged
            </Badge>
          )}
        </div>
      </div>

      <div className="grid gap-6 lg:grid-cols-3">
        <Card className="lg:col-span-2 bg-card border-border">
          <CardHeader>
            <CardTitle className="text-lg">Transaction</CardTitle>
          </CardHeader>
          <CardContent className="grid sm:grid-cols-2 gap-4 text-sm">
            <div>
              <p className="text-muted-foreground">Amount</p>
              <p className="font-semibold text-lg">{formatMoney(txn.amount, txn.currency)}</p>
            </div>
            <div>
              <p className="text-muted-foreground">Fee / Net</p>
              <p className="font-medium">
                {formatMoney(txn.fee ?? 0, txn.currency)} / {formatMoney(txn.netAmount ?? txn.amount, txn.currency)}
              </p>
              {feeBreakdown && (
                <div className="mt-2 space-y-1 text-xs text-muted-foreground">
                  {(feeBreakdown.platform_fee_kobo ?? 0) > 0 && (
                    <p>
                      Platform ({feeBreakdown.platform_fee_percent ?? 0}%):{" "}
                      {formatKobo(feeBreakdown.platform_fee_kobo ?? 0, txn.currency)}
                    </p>
                  )}
                  {(feeBreakdown.transaction_fee_kobo ?? 0) > 0 && (
                    <p>
                      Transaction: {formatKobo(feeBreakdown.transaction_fee_kobo ?? 0, txn.currency)}
                    </p>
                  )}
                </div>
              )}
            </div>
            <div>
              <p className="text-muted-foreground">Created</p>
              <p>{format(txn.createdAt, "MMM d, yyyy HH:mm:ss")}</p>
            </div>
            <div>
              <p className="text-muted-foreground">Completed</p>
              <p>{txn.processedAt ? format(txn.processedAt, "MMM d, yyyy HH:mm:ss") : "—"}</p>
            </div>
            <div>
              <p className="text-muted-foreground">Provider ref</p>
              <p className="font-mono text-xs break-all">{txn.providerRef ?? "—"}</p>
            </div>
            {(() => {
              const trackId = getCryptoTrackId({
                providerRef: txn.providerRef,
                metadata: txn.metadata,
                currency: txn.currency,
                provider: txn.provider,
              });
              if (!trackId) return null;
              return (
                <div className="sm:col-span-2">
                  <p className="text-muted-foreground">On-chain transaction ID</p>
                  <div className="mt-1 flex flex-wrap items-center gap-2">
                    <p className="font-mono text-xs break-all">{trackId}</p>
                    <Button
                      type="button"
                      variant="ghost"
                      size="sm"
                      className="h-7 px-2"
                      onClick={() => {
                        void navigator.clipboard.writeText(trackId).then(
                          () => toast.success("Copied on-chain ID"),
                          () => toast.error("Could not copy")
                        );
                      }}
                    >
                      <Copy className="h-3.5 w-3.5" />
                    </Button>
                    <Button type="button" variant="outline" size="sm" className="h-7 gap-1.5" asChild>
                      <a href={solanaExplorerTxUrl(trackId)} target="_blank" rel="noopener noreferrer">
                        <ExternalLink className="h-3.5 w-3.5" />
                        Solscan
                      </a>
                    </Button>
                  </div>
                </div>
              );
            })()}
            <div>
              <p className="text-muted-foreground">Transaction ID</p>
              <p className="font-mono text-xs break-all">{txn.id}</p>
            </div>
          </CardContent>
        </Card>

        <Card className="bg-card border-border">
          <CardHeader>
            <CardTitle className="text-lg flex items-center gap-2">
              <User className="w-4 h-4" />
              User
            </CardTitle>
          </CardHeader>
          <CardContent className="space-y-2 text-sm">
            <p className="font-semibold">{txn.userName || "—"}</p>
            <p className="text-muted-foreground">{txn.userPhone ?? txn.userEmail ?? "—"}</p>
            <Button variant="outline" size="sm" className="mt-2" asChild>
              <Link to={`/admin/users`}>View users</Link>
            </Button>
          </CardContent>
        </Card>
      </div>

      <div className="grid gap-6 lg:grid-cols-2">
        <Card className="bg-card border-border">
          <CardHeader>
            <CardTitle className="text-lg">PSP Timeline</CardTitle>
          </CardHeader>
          <CardContent>
            <PspTimeline events={pspEvents} />
          </CardContent>
        </Card>

        <Card className="bg-card border-border">
          <CardHeader>
            <CardTitle className="text-lg">Related Webhooks</CardTitle>
          </CardHeader>
          <CardContent>
            {relatedWebhooks.length === 0 ? (
              <p className="text-sm text-muted-foreground">No matching webhook deliveries.</p>
            ) : (
              <div className="space-y-2">
                {relatedWebhooks.map((wh) => (
                  <Link
                    key={wh.id}
                    to={`/admin/webhooks?highlight=${wh.id}`}
                    className="flex items-center justify-between p-3 rounded-lg bg-muted/30 border border-border hover:bg-muted/50 transition-colors"
                  >
                    <div>
                      <p className="text-sm font-medium capitalize">{wh.provider}</p>
                      <p className="text-xs text-muted-foreground">{wh.eventType ?? "event"}</p>
                    </div>
                    <div className="flex items-center gap-2">
                      <Badge variant={wh.processed ? "secondary" : "destructive"} className="text-xs">
                        {wh.processed ? "processed" : "pending"}
                      </Badge>
                      <ExternalLink className="w-4 h-4 text-muted-foreground" />
                    </div>
                  </Link>
                ))}
              </div>
            )}
          </CardContent>
        </Card>
      </div>

      {ledgerEntries.length > 0 && (
        <Card className="bg-card border-border">
          <CardHeader>
            <CardTitle className="text-lg">Ledger Entries</CardTitle>
          </CardHeader>
          <CardContent className="p-0">
            <Table>
              <TableHeader>
                <TableRow>
                  <TableHead>Type</TableHead>
                  <TableHead>Amount</TableHead>
                  <TableHead>Balance before</TableHead>
                  <TableHead>Balance after</TableHead>
                  <TableHead>Time</TableHead>
                </TableRow>
              </TableHeader>
              <TableBody>
                {ledgerEntries.map((entry) => (
                  <TableRow key={entry.id}>
                    <TableCell className="capitalize">{entry.entryType}</TableCell>
                    <TableCell>{formatMoney(entry.amount, txn.currency)}</TableCell>
                    <TableCell>{formatMoney(entry.balanceBefore, txn.currency)}</TableCell>
                    <TableCell>{formatMoney(entry.balanceAfter, txn.currency)}</TableCell>
                    <TableCell className="text-muted-foreground text-sm">
                      {format(entry.createdAt, "MMM d HH:mm:ss")}
                    </TableCell>
                  </TableRow>
                ))}
              </TableBody>
            </Table>
          </CardContent>
        </Card>
      )}

      {txn.metadata && Object.keys(txn.metadata).length > 0 && (
        <Card className="bg-card border-border">
          <CardHeader>
            <CardTitle className="text-lg">Metadata</CardTitle>
          </CardHeader>
          <CardContent>
            <pre className="text-xs bg-muted p-4 rounded-lg overflow-x-auto">
              {JSON.stringify(txn.metadata, null, 2)}
            </pre>
          </CardContent>
        </Card>
      )}
    </div>
  );
};
