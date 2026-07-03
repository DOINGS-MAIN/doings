import { useEffect, useState } from "react";
import { Link } from "react-router-dom";
import { formatDistanceToNow } from "date-fns";
import { AlertTriangle, Clock, Flag, Loader2, RefreshCw, Webhook } from "lucide-react";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { useAdminMonitoring } from "@/hooks/useAdminMonitoring";
import type { ReviewQueue } from "@/types/admin";

function QueueSection({
  title,
  icon: Icon,
  items,
  emptyText,
  linkFor,
}: {
  title: string;
  icon: React.ComponentType<{ className?: string }>;
  items: ReviewQueue["stuckWithdrawals"];
  emptyText: string;
  linkFor: (item: ReviewQueue["stuckWithdrawals"][0]) => string;
}) {
  return (
    <Card>
      <CardHeader>
        <CardTitle className="text-lg flex items-center gap-2">
          <Icon className="w-5 h-5" />
          {title}
          <Badge variant="outline" className="ml-auto">{items.length}</Badge>
        </CardTitle>
      </CardHeader>
      <CardContent>
        {items.length === 0 ? (
          <p className="text-sm text-muted-foreground">{emptyText}</p>
        ) : (
          <div className="space-y-2">
            {items.map((item) => (
              <Link
                key={item.id}
                to={linkFor(item)}
                className="flex items-center justify-between p-3 rounded-lg border border-border hover:bg-muted/30 transition-colors"
              >
                <div className="min-w-0">
                  <p className="font-medium truncate">
                    {item.userName || item.provider || item.eventType || item.id}
                  </p>
                  <p className="text-xs font-mono text-muted-foreground truncate">
                    {item.reference || item.idempotencyKey || item.id}
                  </p>
                  {item.processingError && (
                    <p className="text-xs text-destructive mt-1 truncate">{item.processingError}</p>
                  )}
                  {item.flagReason && (
                    <p className="text-xs text-amber-600 mt-1 truncate">{item.flagReason}</p>
                  )}
                </div>
                <div className="text-right shrink-0 ml-3">
                  {item.status && <Badge variant="secondary" className="text-xs capitalize">{item.status}</Badge>}
                  <p className="text-xs text-muted-foreground mt-1">
                    {formatDistanceToNow(item.createdAt, { addSuffix: true })}
                  </p>
                </div>
              </Link>
            ))}
          </div>
        )}
      </CardContent>
    </Card>
  );
}

export const AdminQueue = () => {
  const { fetchQueue } = useAdminMonitoring();
  const [queue, setQueue] = useState<ReviewQueue | null>(null);
  const [loading, setLoading] = useState(true);

  const load = async () => {
    setLoading(true);
    try {
      setQueue(await fetchQueue());
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => {
    load();
  }, [fetchQueue]);

  if (loading && !queue) {
    return (
      <div className="p-8 flex items-center justify-center text-muted-foreground">
        <Loader2 className="w-5 h-5 animate-spin mr-2" />
        Loading review queue…
      </div>
    );
  }

  const data = queue!;

  return (
    <div className="p-8 space-y-6">
      <div className="flex items-start justify-between gap-4">
        <div>
          <h1 className="text-3xl font-bold text-foreground">Review Queue</h1>
          <p className="text-muted-foreground mt-1">Stuck withdrawals, unprocessed webhooks, and flagged transactions</p>
        </div>
        <Button variant="outline" onClick={load} disabled={loading}>
          <RefreshCw className={`w-4 h-4 mr-2 ${loading ? "animate-spin" : ""}`} />
          Refresh
        </Button>
      </div>

      <div className="grid gap-6 lg:grid-cols-3">
        <QueueSection
          title="Stuck withdrawals"
          icon={Clock}
          items={data.stuckWithdrawals}
          emptyText="No withdrawals stuck in pending/processing."
          linkFor={(item) => `/admin/transactions/${item.id}`}
        />
        <QueueSection
          title="Unprocessed webhooks"
          icon={Webhook}
          items={data.unprocessedWebhooks}
          emptyText="All webhooks processed."
          linkFor={(item) => `/admin/webhooks?highlight=${item.id}`}
        />
        <QueueSection
          title="Flagged transactions"
          icon={Flag}
          items={data.flaggedTransactions}
          emptyText="No flagged transactions."
          linkFor={(item) => `/admin/transactions/${item.id}`}
        />
      </div>

      {(data.stuckWithdrawals.length > 0 || data.unprocessedWebhooks.length > 0) && (
        <Card className="border-amber-500/30 bg-amber-500/5">
          <CardContent className="pt-6 flex gap-3">
            <AlertTriangle className="w-5 h-5 text-amber-600 shrink-0" />
            <p className="text-sm text-muted-foreground">
              Stuck withdrawals are polled automatically by the reconcile cron. Unprocessed webhooks can be reprocessed
              from the Webhooks page (finance/super admin only).
            </p>
          </CardContent>
        </Card>
      )}
    </div>
  );
};
