import { useEffect, useState } from "react";
import { useNavigate, useParams } from "react-router-dom";
import { Loader2 } from "lucide-react";
import { EventScreenView } from "@/components/EventScreenView";
import { useAuth } from "@/hooks/useAuth";
import { mapDbEvent, type EventData } from "@/hooks/useEvents";
import { useGiveaways } from "@/hooks/useGiveaways";
import { events as eventsApi, supabase } from "@/lib/supabase";
import { toast } from "sonner";

/**
 * Full-page TV / projector display for a live event. Routed at `/events/:eventId/screen`.
 */
export default function EventScreenPage() {
  const { eventId } = useParams<{ eventId: string }>();
  const navigate = useNavigate();
  const { profile } = useAuth();
  const { getMyGiveaways } = useGiveaways();

  const [event, setEvent] = useState<EventData | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    if (!eventId) {
      setError("Missing event");
      setLoading(false);
      return;
    }

    let cancelled = false;

    (async () => {
      setLoading(true);
      setError(null);
      try {
        const res = (await eventsApi.getById(eventId)) as { event?: Record<string, unknown> };
        if (cancelled) return;
        if (!res.event?.id) {
          setError("Event not found");
          setEvent(null);
          return;
        }
        const mapped = mapDbEvent(res.event);
        if (mapped.status !== "live") {
          toast.info("Event screen is only available while the event is live.");
          navigate("/events", { replace: true });
          return;
        }
        setEvent(mapped);
      } catch {
        if (!cancelled) setError("Could not load this event.");
      } finally {
        if (!cancelled) setLoading(false);
      }
    })();

    return () => {
      cancelled = true;
    };
  }, [eventId, navigate]);

  useEffect(() => {
    if (!eventId || !event || event.status !== "live") return;

    const channel = supabase
      .channel(`event-screen-${eventId}`)
      .on(
        "postgres_changes",
        { event: "UPDATE", schema: "public", table: "events", filter: `id=eq.${eventId}` },
        (payload) => {
          const row = payload.new as Record<string, unknown>;
          if ((row.status as string) !== "live") {
            toast.info("This event has ended.");
            navigate("/events", { replace: true });
            return;
          }
          setEvent((prev) =>
            prev
              ? {
                  ...prev,
                  participants: Number(row.participant_count ?? prev.participants),
                  totalSprayed: Number(row.total_sprayed ?? 0) / 100,
                  status: row.status as EventData["status"],
                }
              : prev,
          );
        },
      )
      .subscribe();

    return () => {
      supabase.removeChannel(channel);
    };
  }, [eventId, event, navigate]);

  const giveaways = getMyGiveaways();

  if (loading) {
    return (
      <div className="flex min-h-dvh flex-col items-center justify-center gap-3 bg-background">
        <Loader2 className="h-10 w-10 animate-spin text-primary" />
        <p className="text-sm text-muted-foreground">Loading event screen…</p>
      </div>
    );
  }

  if (error || !event) {
    return (
      <div className="flex min-h-dvh flex-col items-center justify-center gap-4 bg-background px-6 text-center">
        <p className="text-lg font-semibold text-foreground">{error ?? "Event not found"}</p>
        <button
          type="button"
          onClick={() => navigate("/events")}
          className="rounded-xl bg-primary px-6 py-3 font-semibold text-primary-foreground"
        >
          Back to events
        </button>
      </div>
    );
  }

  if (!profile?.id) {
    return (
      <div className="flex min-h-dvh flex-col items-center justify-center gap-3 bg-background">
        <Loader2 className="h-10 w-10 animate-spin text-primary" />
        <p className="text-sm text-muted-foreground">Loading your profile…</p>
      </div>
    );
  }

  if (event.hostId !== profile.id) {
    return (
      <div className="flex min-h-dvh flex-col items-center justify-center gap-4 bg-background px-6 text-center">
        <p className="text-lg font-semibold text-foreground">Only the event host can open this screen.</p>
        <button
          type="button"
          onClick={() => navigate("/events")}
          className="rounded-xl bg-primary px-6 py-3 font-semibold text-primary-foreground"
        >
          Back to events
        </button>
      </div>
    );
  }

  return <EventScreenView event={event} giveaways={giveaways} onBack={() => navigate("/events")} />;
}
