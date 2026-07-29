import { useEffect, useMemo, useState } from "react";
import { motion } from "framer-motion";
import { Users, X, Maximize2, Loader2 } from "lucide-react";
import { EventData } from "@/hooks/useEvents";
import { useLiveSprayHolds } from "@/hooks/useLiveSprayHolds";
import { buildEventJoinLink } from "@/lib/shareLinks";
import { EventScreenDanceFloor } from "@/components/EventScreenDanceFloor";
import { EventScreenIdleView } from "@/components/EventScreenIdleView";
import { EventScreenJoinQr } from "@/components/EventScreenJoinQr";
import { EventScreenGiveawaysBanner } from "@/components/EventScreenGiveawaysBanner";
import type { ProjectorGiveawayDisplay } from "@/hooks/useEventScreenGiveaways";
import { STAGE_SLOT_COUNT } from "@/hooks/useSprayStage";

export interface EventScreenViewProps {
  event: EventData;
  giveaways: ProjectorGiveawayDisplay[];
  onBack: () => void;
  /** Hide host close control for anonymous public viewers. */
  showCloseButton?: boolean;
  /** Strip header chrome for iframe / TV embeds (`?embed=1`). */
  embed?: boolean;
  /** Rate-limited edge feed for anonymous viewers. */
  publicViewer?: boolean;
}

export const EventScreenView = ({
  event,
  giveaways,
  onBack,
  showCloseButton = true,
  embed = false,
  publicViewer = false,
}: EventScreenViewProps) => {
  const [isFullscreen, setIsFullscreen] = useState(false);
  const { liveSprays, loading, error } = useLiveSprayHolds(event.id, event.status === "live", {
    publicViewer,
    eventCode: event.eventCode,
  });

  const joinLink = buildEventJoinLink(event.eventCode);

  const danceFloorSprayers = useMemo(
    () =>
      [...liveSprays]
        .sort((a, b) => a.timestamp.getTime() - b.timestamp.getTime())
        .slice(0, STAGE_SLOT_COUNT),
    [liveSprays],
  );

  const isProjectorIdle = !loading && danceFloorSprayers.length === 0;

  const toggleFullscreen = () => {
    if (!document.fullscreenElement) {
      void document.documentElement.requestFullscreen();
      setIsFullscreen(true);
    } else {
      void document.exitFullscreen();
      setIsFullscreen(false);
    }
  };

  useEffect(() => {
    const onFsChange = () => setIsFullscreen(Boolean(document.fullscreenElement));
    document.addEventListener("fullscreenchange", onFsChange);
    return () => document.removeEventListener("fullscreenchange", onFsChange);
  }, []);

  if (error && !loading && danceFloorSprayers.length === 0) {
    return (
      <div className="flex min-h-dvh flex-col items-center justify-center gap-3 bg-black px-6 text-center text-white">
        <p className="text-lg font-semibold">Could not load live sprays</p>
        <p className="max-w-md text-sm text-white/60">{error}</p>
        {showCloseButton && (
          <button
            type="button"
            onClick={onBack}
            className="mt-2 rounded-xl bg-primary px-6 py-3 font-semibold text-primary-foreground"
          >
            Back to events
          </button>
        )}
      </div>
    );
  }

  if (isProjectorIdle) {
    return (
      <EventScreenIdleView
        event={event}
        joinLink={joinLink}
        isFullscreen={isFullscreen}
        onToggleFullscreen={toggleFullscreen}
        onBack={onBack}
        showCloseButton={showCloseButton}
        embed={embed}
        giveaways={giveaways}
      />
    );
  }

  const qrOverlay = (
    <div
      className={
        embed
          ? "pointer-events-none absolute bottom-4 right-4 z-30 md:bottom-6 md:right-6"
          : "relative z-20 flex shrink-0 justify-end px-5 pb-5 md:px-8 md:pb-6"
      }
    >
      <EventScreenJoinQr joinLink={joinLink} eventCode={event.eventCode} compact />
    </div>
  );

  if (embed) {
    return (
      <div className="relative flex min-h-dvh max-h-dvh flex-col overflow-hidden bg-black">
        <EventScreenGiveawaysBanner giveaways={giveaways} compact />
        <div className="relative z-10 min-h-0 flex-1">
          {loading && danceFloorSprayers.length === 0 ? (
            <div className="flex h-full items-center justify-center gap-2 text-white/50">
              <Loader2 className="h-5 w-5 animate-spin" />
              Loading…
            </div>
          ) : (
            <EventScreenDanceFloor sprayers={danceFloorSprayers} />
          )}
        </div>
        {qrOverlay}
      </div>
    );
  }

  return (
    <div className="relative flex min-h-dvh max-h-dvh flex-col overflow-hidden bg-black">
      <div className="pointer-events-none absolute inset-0 bg-gradient-to-b from-black/30 via-transparent to-black/70" />

      <EventScreenGiveawaysBanner giveaways={giveaways} />

      <div className="relative z-20 flex shrink-0 items-center justify-between px-5 py-3 md:px-8">
        <div className="flex min-w-0 items-center gap-3">
          <div
            className={`flex h-10 w-10 shrink-0 items-center justify-center rounded-xl bg-gradient-to-br text-xl ${event.gradient}`}
          >
            {event.emoji}
          </div>
          <div className="min-w-0">
            <h2 className="truncate text-lg font-black text-white md:text-xl">{event.title}</h2>
            <div className="flex items-center gap-2 text-xs text-white/55 md:text-sm">
              <span className="flex items-center gap-1.5 font-semibold text-green-400">
                <span className="h-1.5 w-1.5 animate-pulse rounded-full bg-green-500" />
                LIVE
              </span>
              <span>·</span>
              <span className="flex items-center gap-1">
                <Users className="h-3.5 w-3.5" />
                {event.participants} guests
              </span>
            </div>
          </div>
        </div>
        <div className="flex shrink-0 items-center gap-2">
          <motion.button
            type="button"
            onClick={() => void toggleFullscreen()}
            className="rounded-xl bg-white/10 p-2 text-white backdrop-blur hover:bg-white/15"
            whileTap={{ scale: 0.95 }}
            aria-label={isFullscreen ? "Exit fullscreen" : "Enter fullscreen"}
          >
            <Maximize2 className="h-5 w-5" />
          </motion.button>
          {showCloseButton && (
            <motion.button
              type="button"
              onClick={onBack}
              className="rounded-xl bg-white/10 p-2 text-white backdrop-blur hover:bg-white/15"
              whileTap={{ scale: 0.95 }}
              aria-label="Close event screen"
            >
              <X className="h-5 w-5" />
            </motion.button>
          )}
        </div>
      </div>

      <div className="relative z-10 min-h-0 flex-1">
        {loading && danceFloorSprayers.length === 0 ? (
          <div className="flex h-full items-center justify-center gap-2 text-white/50">
            <Loader2 className="h-5 w-5 animate-spin" />
            Loading…
          </div>
        ) : (
          <EventScreenDanceFloor sprayers={danceFloorSprayers} />
        )}
      </div>

      {qrOverlay}
    </div>
  );
};
