import { motion, AnimatePresence } from "framer-motion";
import {
  Trophy,
  Gift,
  Sparkles,
  Users,
  X,
  Maximize2,
  Crown,
  Medal,
  Loader2,
} from "lucide-react";
import { formatDistanceToNow } from "date-fns";
import { EventData } from "@/hooks/useEvents";
import { Giveaway } from "@/hooks/useGiveaways";
import { useEventSprayFeed } from "@/hooks/useEventSprayFeed";
import { useSprayStage } from "@/hooks/useSprayStage";
import { buildEventJoinLink, buildGiveawayRedeemLink } from "@/lib/shareLinks";
import { EventScreenSprayStage } from "@/components/EventScreenSprayStage";
import { EventScreenIdleView } from "@/components/EventScreenIdleView";
import { SprayAvatarCharacter } from "@/components/SprayAvatarCharacter";
import QRCode from "react-qr-code";
import { useEffect, useState } from "react";
import { formatSprayDenomination } from "@/lib/sprayNotes";

export interface EventScreenViewProps {
  event: EventData;
  giveaways: Giveaway[];
  onBack: () => void;
}

export const EventScreenView = ({ event, giveaways, onBack }: EventScreenViewProps) => {
  const [isFullscreen, setIsFullscreen] = useState(false);
  const { activities, topGifters, loading, error } = useEventSprayFeed(
    event.id,
    event.status === "live",
  );
  const { slots, queuedSprays, waitingCount } = useSprayStage(
    event.id,
    activities,
    event.status === "live",
  );

  const activeGiveaways = giveaways.filter(
    (g) => g.status === "active" && g.eventId === event.id && g.showOnEventScreen,
  );
  const joinLink = buildEventJoinLink(event.eventCode);

  const isProjectorIdle =
    !loading &&
    slots.every((slot) => slot == null) &&
    queuedSprays.length === 0;

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

  if (isProjectorIdle) {
    return (
      <EventScreenIdleView
        event={event}
        joinLink={joinLink}
        isFullscreen={isFullscreen}
        onToggleFullscreen={toggleFullscreen}
        onBack={onBack}
      />
    );
  }

  return (
    <div className="relative flex min-h-dvh max-h-dvh flex-col overflow-hidden bg-gradient-to-br from-background via-background to-primary/10">
      <div className="pointer-events-none absolute inset-0 overflow-hidden">
        {[...Array(8)].map((_, i) => (
          <motion.span
            key={i}
            className="absolute text-2xl opacity-20"
            style={{ left: `${10 + i * 11}%`, top: `${15 + (i % 3) * 25}%` }}
            animate={{ y: [0, -20, 0], opacity: [0.1, 0.35, 0.1], rotate: [0, 15, 0] }}
            transition={{ duration: 3 + i * 0.4, repeat: Infinity, delay: i * 0.2 }}
          >
            ✨
          </motion.span>
        ))}
      </div>

      <div className="relative z-10 flex shrink-0 items-center justify-between border-b border-border p-4">
        <div className="flex min-w-0 items-center gap-3">
          <div
            className={`flex h-12 w-12 shrink-0 items-center justify-center rounded-xl bg-gradient-to-br text-2xl ${event.gradient}`}
          >
            {event.emoji}
          </div>
          <div className="min-w-0">
            <h2 className="truncate text-xl font-black text-foreground">{event.title}</h2>
            <div className="flex flex-wrap items-center gap-2 text-sm text-muted-foreground">
              <span className="flex items-center gap-1">
                <span className="h-2 w-2 animate-pulse rounded-full bg-green-500" />
                LIVE
              </span>
              <span>•</span>
              <span className="flex items-center gap-1">
                <Users className="h-4 w-4 shrink-0" />
                {event.participants} guests
              </span>
            </div>
          </div>
        </div>
        <div className="flex shrink-0 items-center gap-2">
          <motion.button
            type="button"
            onClick={() => void toggleFullscreen()}
            className="rounded-xl bg-muted p-2 transition-colors hover:bg-muted/80"
            whileTap={{ scale: 0.95 }}
            aria-label={isFullscreen ? "Exit fullscreen" : "Enter fullscreen"}
          >
            <Maximize2 className="h-5 w-5 text-foreground" />
          </motion.button>
          <motion.button
            type="button"
            onClick={onBack}
            className="rounded-xl bg-muted p-2 transition-colors hover:bg-muted/80"
            whileTap={{ scale: 0.95 }}
            aria-label="Close event screen"
          >
            <X className="h-5 w-5 text-foreground" />
          </motion.button>
        </div>
      </div>

      <div className="relative z-10 grid min-h-0 flex-1 grid-cols-1 gap-4 overflow-y-auto overscroll-y-contain p-4 [-webkit-overflow-scrolling:touch] md:grid-cols-3">
        <div className="space-y-4 md:col-span-2">
          <EventScreenSprayStage slots={slots} queuedSprays={queuedSprays} waitingCount={waitingCount} />

          {activities.length > 0 && (
            <>
              <div className="mb-2 flex items-center gap-2">
                <Sparkles className="h-5 w-5 text-primary" />
                <h3 className="font-bold text-foreground">Recent Sprays</h3>
              </div>

              {error ? (
                <div className="glass rounded-2xl p-6 text-center text-sm text-destructive">{error}</div>
              ) : (
                <div className="space-y-3">
                  <AnimatePresence initial={false}>
                    {activities.slice(0, 8).map((activity, index) => (
                      <motion.div
                        key={activity.id}
                        initial={{ opacity: 0, x: -80, scale: 0.85 }}
                        animate={{ opacity: 1, x: 0, scale: 1 }}
                        exit={{ opacity: 0, x: 50 }}
                        transition={{ type: "spring", stiffness: 320, damping: 24, delay: index * 0.03 }}
                        className="glass flex items-center gap-4 rounded-2xl p-4"
                      >
                        <SprayAvatarCharacter
                          avatar={activity.avatarData}
                          name={activity.name}
                          size="md"
                          dancing={index === 0}
                          danceStyle={index === 0 ? "celebrate" : "bounce"}
                          showGlow={index === 0}
                        />
                        <div className="min-w-0 flex-1">
                          <p className="truncate text-lg font-bold text-foreground">{activity.name}</p>
                          <p className="text-sm text-muted-foreground">
                            {formatDistanceToNow(activity.timestamp, { addSuffix: true })}
                            {activity.denomination > 0 && (
                              <> · {formatSprayDenomination(activity.denomination)} notes</>
                            )}
                          </p>
                        </div>
                        <motion.div
                          initial={{ scale: 0, rotate: -12 }}
                          animate={{ scale: 1, rotate: 0 }}
                          className="shrink-0 rounded-xl bg-gradient-to-r from-primary to-accent px-4 py-2 shadow-lg shadow-primary/20"
                        >
                          <p className="text-lg font-black text-primary-foreground">
                            ₦{activity.amount.toLocaleString()}
                          </p>
                        </motion.div>
                      </motion.div>
                    ))}
                  </AnimatePresence>
                </div>
              )}
            </>
          )}

          {loading && activities.length === 0 && (
            <div className="glass flex items-center justify-center gap-2 rounded-2xl p-8 text-muted-foreground">
              <Loader2 className="h-5 w-5 animate-spin" />
              Loading sprays…
            </div>
          )}

          <motion.div
            initial={{ opacity: 0, y: 20 }}
            animate={{ opacity: 1, y: 0 }}
            className="glass rounded-2xl p-6 text-center"
          >
            <p className="mb-2 text-muted-foreground">Total Sprayed</p>
            <motion.p
              className="text-4xl font-black text-gradient-gold"
              key={event.totalSprayed}
              initial={{ scale: 1.15 }}
              animate={{ scale: 1 }}
              transition={{ type: "spring", stiffness: 400 }}
            >
              ₦{(event.totalSprayed || 0).toLocaleString()}
            </motion.p>
          </motion.div>
        </div>

        <div className="space-y-4">
          {topGifters.length > 0 && (
            <div className="glass rounded-2xl p-4">
              <div className="mb-4 flex items-center gap-2">
                <Trophy className="h-5 w-5 text-yellow-500" />
                <h3 className="font-bold text-foreground">Top Gifters</h3>
              </div>

              <div className="space-y-3">
                {topGifters.map((gifter, index) => (
                  <motion.div
                    key={gifter.sprayerId}
                    initial={{ opacity: 0, x: 20 }}
                    animate={{ opacity: 1, x: 0 }}
                    transition={{ delay: index * 0.1 }}
                    className="flex items-center gap-3"
                  >
                    <div className="flex h-8 w-8 items-center justify-center rounded-lg bg-muted">
                      {index === 0 && <Crown className="h-4 w-4 text-yellow-400" />}
                      {index === 1 && <Medal className="h-4 w-4 text-gray-300" />}
                      {index === 2 && <Medal className="h-4 w-4 text-amber-600" />}
                    </div>
                    <SprayAvatarCharacter
                      avatar={gifter.avatarData}
                      name={gifter.name}
                      size="sm"
                      dancing={index === 0}
                      danceStyle="sway"
                    />
                    <div className="min-w-0 flex-1">
                      <p className="truncate text-sm font-bold text-foreground">{gifter.name}</p>
                    </div>
                    <p className="shrink-0 font-bold text-primary">₦{gifter.amount.toLocaleString()}</p>
                  </motion.div>
                ))}
              </div>
            </div>
          )}

          {activeGiveaways.length > 0 && (
            <div className="glass rounded-2xl p-4">
              <div className="mb-4 flex items-center gap-2">
                <Gift className="h-5 w-5 text-accent" />
                <h3 className="font-bold text-foreground">Active Giveaways</h3>
              </div>

              <div className="space-y-4">
                {activeGiveaways.map((giveaway) => (
                  <motion.div
                    key={giveaway.id}
                    initial={{ opacity: 0, scale: 0.9 }}
                    animate={{ opacity: 1, scale: 1 }}
                    className="rounded-xl border border-accent/30 bg-gradient-to-br from-accent/20 to-primary/20 p-4"
                  >
                    <h4 className="mb-2 font-bold text-foreground">{giveaway.title}</h4>
                    <p className="mb-3 text-sm text-muted-foreground">
                      ₦{giveaway.perPersonAmount.toLocaleString()} per person
                    </p>

                    <div className="mx-auto w-fit rounded-xl bg-white p-3">
                      <QRCode value={buildGiveawayRedeemLink(giveaway.code)} size={100} level="M" />
                    </div>

                    <div className="mt-3 text-center">
                      <p className="text-xs text-muted-foreground">Code</p>
                      <p className="font-mono text-lg font-bold tracking-widest text-primary">{giveaway.code}</p>
                    </div>
                  </motion.div>
                ))}
              </div>
            </div>
          )}

          <div className="glass rounded-2xl p-4 text-center">
            <p className="mb-2 text-sm text-muted-foreground">Join this event</p>
            <div className="mx-auto mb-3 w-fit rounded-xl bg-white p-3">
              <QRCode value={joinLink} size={100} level="M" />
            </div>
            <p className="font-mono text-2xl font-bold tracking-widest text-primary">{event.eventCode}</p>
          </div>
        </div>
      </div>
    </div>
  );
};
