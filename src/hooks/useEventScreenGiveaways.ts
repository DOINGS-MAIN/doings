import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { supabase } from "@/lib/supabase";
import { fetchProjectorGiveaways } from "@/lib/publicEventScreen";
import type { EventScreenGiveaway } from "@/components/EventScreenGiveawaysBanner";

const EXHAUSTED_GRACE_MS = 60_000;

export function remainingGiveawaySpots(giveaway: EventScreenGiveaway): number {
  if (giveaway.perPersonAmount <= 0) return 0;
  return Math.floor(giveaway.remainingAmount / giveaway.perPersonAmount);
}

type GraceEntry = {
  giveaway: EventScreenGiveaway;
  exhaustedAt: number;
};

export type ProjectorGiveawayDisplay = EventScreenGiveaway & {
  spotsLeft: number;
  exhausted: boolean;
};

function mergeGraceEntries(
  previous: EventScreenGiveaway[],
  next: EventScreenGiveaway[],
  graceById: Map<string, GraceEntry>,
): Map<string, GraceEntry> {
  const updated = new Map(graceById);
  const now = Date.now();
  const nextById = new Map(next.map((g) => [g.id, g]));

  for (const prev of previous) {
    const prevSpots = remainingGiveawaySpots(prev);
    if (prevSpots <= 0) continue;

    const current = nextById.get(prev.id);
    const currentSpots = current ? remainingGiveawaySpots(current) : 0;

    if (currentSpots === 0) {
      updated.set(prev.id, {
        giveaway: current ?? { ...prev, remainingAmount: 0 },
        exhaustedAt: now,
      });
    }
  }

  return updated;
}

function pruneGraceEntries(graceById: Map<string, GraceEntry>, now: number): Map<string, GraceEntry> {
  const pruned = new Map<string, GraceEntry>();
  for (const [id, entry] of graceById) {
    if (now - entry.exhaustedAt < EXHAUSTED_GRACE_MS) {
      pruned.set(id, entry);
    }
  }
  return pruned;
}

/** Live projector giveaways with slot countdown + 60s grace after exhaustion. */
export function useEventScreenGiveaways(eventId: string | undefined, eventLive: boolean) {
  const [fetched, setFetched] = useState<EventScreenGiveaway[]>([]);
  const [graceById, setGraceById] = useState<Map<string, GraceEntry>>(() => new Map());
  const [now, setNow] = useState(() => Date.now());
  const previousFetchedRef = useRef<EventScreenGiveaway[]>([]);

  const refresh = useCallback(async () => {
    if (!eventId) {
      setFetched([]);
      previousFetchedRef.current = [];
      return;
    }

    const next = await fetchProjectorGiveaways(eventId);
    const previous = previousFetchedRef.current;

    setGraceById((grace) => mergeGraceEntries(previous, next, grace));
    previousFetchedRef.current = next;
    setFetched(next);
  }, [eventId]);

  useEffect(() => {
    if (!eventId || !eventLive) {
      setFetched([]);
      setGraceById(new Map());
      previousFetchedRef.current = [];
      return;
    }

    void refresh();
  }, [eventId, eventLive, refresh]);

  useEffect(() => {
    if (!eventId || !eventLive) return;

    const channel = supabase
      .channel(`event-screen-giveaways-${eventId}`)
      .on(
        "postgres_changes",
        { event: "UPDATE", schema: "public", table: "giveaways", filter: `event_id=eq.${eventId}` },
        () => {
          void refresh();
        },
      )
      .on(
        "postgres_changes",
        { event: "INSERT", schema: "public", table: "giveaways", filter: `event_id=eq.${eventId}` },
        () => {
          void refresh();
        },
      )
      .subscribe();

    return () => {
      supabase.removeChannel(channel);
    };
  }, [eventId, eventLive, refresh]);

  useEffect(() => {
    if (graceById.size === 0) return;

    const timer = window.setInterval(() => {
      const current = Date.now();
      setNow(current);
      setGraceById((grace) => pruneGraceEntries(grace, current));
    }, 1000);

    return () => window.clearInterval(timer);
  }, [graceById.size]);

  const displayGiveaways = useMemo((): ProjectorGiveawayDisplay[] => {
    const active = fetched
      .filter((g) => remainingGiveawaySpots(g) > 0)
      .map((g) => ({
        ...g,
        spotsLeft: remainingGiveawaySpots(g),
        exhausted: false,
      }));

    const activeIds = new Set(active.map((g) => g.id));
    const grace = [...graceById.entries()]
      .filter(([id, entry]) => !activeIds.has(id) && now - entry.exhaustedAt < EXHAUSTED_GRACE_MS)
      .map(([, entry]) => ({
        ...entry.giveaway,
        remainingAmount: 0,
        spotsLeft: 0,
        exhausted: true,
      }));

    return [...active, ...grace];
  }, [fetched, graceById, now]);

  return { displayGiveaways, refreshGiveaways: refresh };
}
