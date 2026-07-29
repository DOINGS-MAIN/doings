import { useEffect, useState } from "react";
import { Link, useLocation, useNavigate, useParams } from "react-router-dom";
import { Loader2 } from "lucide-react";
import { EventScreenView } from "@/components/EventScreenView";
import { useAuth } from "@/hooks/useAuth";
import type { EventData } from "@/hooks/useEvents";
import { useGiveaways } from "@/hooks/useGiveaways";
import { fetchProjectorEvent, fetchProjectorEventByCode } from "@/lib/publicEventScreen";
import { isEmbedMode } from "@/lib/eventScreenLink";
import { supabase } from "@/lib/supabase";
import { buildEventJoinLink } from "@/lib/shareLinks";
import { toast } from "sonner";

/**
 * Full-page TV / projector display for a live event.
 * Routes: `/events/:eventId/screen` (host/private) and `/watch/:eventCode` (public share).
 * Add `?embed=1` for iframe/TV chromeless mode.
 */
export default function EventScreenPage() {
  const { eventId, eventCode } = useParams<{ eventId?: string; eventCode?: string }>();
  const location = useLocation();
  const navigate = useNavigate();
  const { profile, initialized, isAuthenticated } = useAuth();
  const { getMyGiveaways } = useGiveaways();

  const embed = isEmbedMode(location.search);

  const [event, setEvent] = useState<EventData | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [accessDenied, setAccessDenied] = useState(false);

  useEffect(() => {
    if (!eventId && !eventCode) {
      setError("Missing event");
      setLoading(false);
      return;
    }

    let cancelled = false;

    (async () => {
      setLoading(true);
      setError(null);
      setAccessDenied(false);

      const mapped = eventId
        ? await fetchProjectorEvent(eventId)
        : await fetchProjectorEventByCode(eventCode ?? "");

      if (cancelled) return;

      if (!mapped) {
        if (!initialized) return;
        setAccessDenied(true);
        setEvent(null);
        setLoading(false);
        return;
      }

      if (mapped.status !== "live") {
        setError("This projector is only available while the event is live.");
        setEvent(null);
        setLoading(false);
        return;
      }

      if (mapped.isPrivate) {
        if (!initialized) return;
        if (!profile?.id || mapped.hostId !== profile.id) {
          setAccessDenied(true);
          setEvent(null);
          setLoading(false);
          return;
        }
      }

      setEvent(mapped);
      setLoading(false);
    })();

    return () => {
      cancelled = true;
    };
  }, [eventId, eventCode, initialized, profile?.id]);

  useEffect(() => {
    if (!event?.id || event.status !== "live") return;

    const channel = supabase
      .channel(`event-screen-${event.id}`)
      .on(
        "postgres_changes",
        { event: "UPDATE", schema: "public", table: "events", filter: `id=eq.${event.id}` },
        (payload) => {
          const row = payload.new as Record<string, unknown>;
          if ((row.status as string) !== "live") {
            toast.info("This event has ended.");
            if (isAuthenticated && profile?.id === event.hostId) {
              navigate("/events", { replace: true });
            } else {
              setEvent((prev) => (prev ? { ...prev, status: "ended" } : prev));
              setError("This event has ended.");
            }
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
  }, [event, navigate, isAuthenticated, profile?.id]);

  const isHost = Boolean(profile?.id && event?.hostId === profile.id);
  const isPublicViewer = Boolean(event && !event.isPrivate && !isHost);
  const giveaways = isHost ? getMyGiveaways() : [];

  const handleBack = () => {
    if (isHost) {
      navigate("/events");
      return;
    }
    if (event?.eventCode) {
      window.location.href = buildEventJoinLink(event.eventCode);
      return;
    }
    navigate("/login");
  };

  if (loading || (!event && !error && !accessDenied)) {
    return (
      <div className="flex min-h-dvh flex-col items-center justify-center gap-3 bg-black">
        <Loader2 className="h-10 w-10 animate-spin text-primary" />
        <p className="text-sm text-white/60">Loading event screen…</p>
      </div>
    );
  }

  if (accessDenied) {
    return (
      <div className="flex min-h-dvh flex-col items-center justify-center gap-4 bg-black px-6 text-center">
        <p className="text-lg font-semibold text-white">This projector is not public</p>
        <p className="max-w-md text-sm text-white/60">
          {isAuthenticated
            ? "Only the event host can open the screen for private events."
            : "This is a private event. Sign in as the host to open the projector, or ask for the public watch link."}
        </p>
        {!embed && (
          <div className="mt-2 flex flex-wrap justify-center gap-3">
            {!isAuthenticated && (
              <Link
                to="/login"
                className="rounded-xl bg-primary px-6 py-3 font-semibold text-primary-foreground"
              >
                Sign in
              </Link>
            )}
            {isAuthenticated && (
              <button
                type="button"
                onClick={() => navigate("/events")}
                className="rounded-xl bg-primary px-6 py-3 font-semibold text-primary-foreground"
              >
                Back to events
              </button>
            )}
          </div>
        )}
      </div>
    );
  }

  if (error || !event) {
    return (
      <div className="flex min-h-dvh flex-col items-center justify-center gap-4 bg-black px-6 text-center">
        <p className="text-lg font-semibold text-white">{error ?? "Event not found"}</p>
        {!embed && (
          isHost ? (
            <button
              type="button"
              onClick={() => navigate("/events")}
              className="rounded-xl bg-primary px-6 py-3 font-semibold text-primary-foreground"
            >
              Back to events
            </button>
          ) : (
            <Link
              to="/login"
              className="rounded-xl bg-primary px-6 py-3 font-semibold text-primary-foreground"
            >
              Join on Doings
            </Link>
          )
        )}
      </div>
    );
  }

  return (
    <EventScreenView
      event={event}
      giveaways={giveaways}
      onBack={handleBack}
      showCloseButton={!isPublicViewer && !embed}
      embed={embed}
      publicViewer={isPublicViewer}
    />
  );
}
