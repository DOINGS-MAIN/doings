import { format } from "date-fns";
import { ArrowDownLeft, ArrowUpRight, Circle } from "lucide-react";
import { Badge } from "@/components/ui/badge";
import type { PspEventRecord } from "@/types/admin";

interface PspTimelineProps {
  events: PspEventRecord[];
}

function directionIcon(direction: PspEventRecord["direction"]) {
  return direction === "inbound" ? (
    <ArrowDownLeft className="w-4 h-4 text-success" />
  ) : (
    <ArrowUpRight className="w-4 h-4 text-accent" />
  );
}

export const PspTimeline = ({ events }: PspTimelineProps) => {
  if (events.length === 0) {
    return (
      <p className="text-sm text-muted-foreground py-6 text-center">
        No PSP events recorded for this transaction yet.
      </p>
    );
  }

  return (
    <div className="space-y-0">
      {events.map((event, index) => (
        <div key={event.id} className="flex gap-4">
          <div className="flex flex-col items-center">
            <div className="w-8 h-8 rounded-full bg-muted flex items-center justify-center shrink-0">
              {directionIcon(event.direction)}
            </div>
            {index < events.length - 1 && <div className="w-px flex-1 bg-border my-1" />}
          </div>
          <div className="pb-6 flex-1 min-w-0">
            <div className="flex flex-wrap items-center gap-2">
              <p className="font-medium text-foreground">{event.eventType}</p>
              <Badge variant="outline" className="text-xs capitalize">{event.providerId}</Badge>
              {event.providerStatus && (
                <Badge variant="secondary" className="text-xs font-mono">{event.providerStatus}</Badge>
              )}
            </div>
            <p className="text-xs text-muted-foreground mt-1">
              {format(event.createdAt, "MMM d, yyyy HH:mm:ss")}
            </p>
            {(event.reference || event.providerRef) && (
              <p className="text-xs font-mono text-muted-foreground mt-1 truncate">
                ref: {event.reference ?? event.providerRef}
              </p>
            )}
            {event.errorMessage && (
              <p className="text-xs text-destructive mt-2">{event.errorMessage}</p>
            )}
            {(event.requestSummary || event.responseSummary) && (
              <details className="mt-2">
                <summary className="text-xs text-primary cursor-pointer">Payload summary</summary>
                <pre className="mt-2 text-xs bg-muted p-3 rounded-lg overflow-x-auto max-h-48">
                  {JSON.stringify(
                    { request: event.requestSummary, response: event.responseSummary },
                    null,
                    2,
                  )}
                </pre>
              </details>
            )}
          </div>
        </div>
      ))}
    </div>
  );
};

export const PspTimelineEmpty = () => (
  <div className="flex items-center gap-2 text-sm text-muted-foreground py-4">
    <Circle className="w-3 h-3" />
    No events
  </div>
);
