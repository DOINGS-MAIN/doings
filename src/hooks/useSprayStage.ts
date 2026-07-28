import { useEffect, useRef, useState } from "react";
import type { EventSprayActivity } from "@/hooks/useEventSprayFeed";

export const STAGE_SLOT_COUNT = 3;
export const STAGE_SLOT_DURATION_MS = 6000;

export type SprayStageStatus = "queued" | "active" | "done";

export interface SprayStageEntry {
  id: string;
  spray: EventSprayActivity;
  status: SprayStageStatus;
  slotIndex?: number;
  activatedAt?: number;
}

function promoteAndComplete(entries: SprayStageEntry[]): SprayStageEntry[] {
  const now = Date.now();
  let next = entries.map((entry) => {
    if (entry.spray.isLive) return entry;

    if (
      entry.status === "active" &&
      entry.activatedAt &&
      now - entry.activatedAt >= STAGE_SLOT_DURATION_MS
    ) {
      return { ...entry, status: "done" as const, slotIndex: undefined };
    }
    return entry;
  });

  next = next.filter((entry) => entry.status !== "done");

  const active = next.filter((entry) => entry.status === "active");
  const openSlots = STAGE_SLOT_COUNT - active.length;
  if (openSlots <= 0) return next;

  const usedSlots = new Set(active.map((entry) => entry.slotIndex));
  const queued = next.filter((entry) => entry.status === "queued");
  let promoted = 0;

  for (const entry of queued) {
    if (promoted >= openSlots) break;

    let slotIndex = 0;
    while (usedSlots.has(slotIndex) && slotIndex < STAGE_SLOT_COUNT) slotIndex += 1;
    if (slotIndex >= STAGE_SLOT_COUNT) break;

    usedSlots.add(slotIndex);
    const idx = next.findIndex((row) => row.id === entry.id);
    if (idx === -1) continue;

    next[idx] = { ...entry, status: "active", slotIndex, activatedAt: now };
    promoted += 1;
  }

  return next;
}

function mergeLiveSprays(
  prev: SprayStageEntry[],
  liveActivities: EventSprayActivity[],
): SprayStageEntry[] {
  const liveIds = new Set(liveActivities.map((spray) => spray.id));
  let next = prev.filter((entry) => !entry.id.startsWith("live-") || liveIds.has(entry.id));

  for (const spray of liveActivities) {
    const existingIdx = next.findIndex((entry) => entry.id === spray.id);
    if (existingIdx >= 0) {
      next[existingIdx] = { ...next[existingIdx], spray };
      continue;
    }
    next.push({ id: spray.id, spray, status: "queued" });
  }

  const active = next.filter((entry) => entry.status === "active");
  const queued = next.filter((entry) => entry.status === "queued");
  const liveQueued = queued.filter((entry) => entry.id.startsWith("live-"));
  const otherQueued = queued.filter((entry) => !entry.id.startsWith("live-"));
  next = [...active, ...liveQueued, ...otherQueued];

  return promoteAndComplete(next);
}

export function useSprayStage(
  eventId: string | undefined,
  activities: EventSprayActivity[],
  enabled = true,
  feedReady = false,
  liveActivities: EventSprayActivity[] = [],
) {
  const [entries, setEntries] = useState<SprayStageEntry[]>([]);
  const seenIdsRef = useRef<Set<string>>(new Set());
  const primedRef = useRef(false);

  useEffect(() => {
    primedRef.current = false;
    seenIdsRef.current.clear();
    setEntries([]);
  }, [eventId]);

  useEffect(() => {
    if (!enabled) return;
    setEntries((prev) => mergeLiveSprays(prev, liveActivities));
  }, [liveActivities, enabled]);

  useEffect(() => {
    if (!enabled || !feedReady) return;

    if (!primedRef.current) {
      activities.forEach((activity) => seenIdsRef.current.add(activity.id));
      primedRef.current = true;
      return;
    }

    const newSprays = activities
      .filter((activity) => !seenIdsRef.current.has(activity.id))
      .sort((a, b) => a.timestamp.getTime() - b.timestamp.getTime());

    if (newSprays.length === 0) return;

    newSprays.forEach((activity) => seenIdsRef.current.add(activity.id));

    setEntries((prev) => {
      let next = [...prev];

      for (const spray of newSprays) {
        const liveEntryIdx = spray.holdId
          ? next.findIndex((entry) => entry.id === `live-${spray.holdId}`)
          : -1;

        if (liveEntryIdx >= 0) {
          const liveEntry = next[liveEntryIdx];
          next[liveEntryIdx] = {
            ...liveEntry,
            id: spray.id,
            spray: { ...spray, isLive: false },
            activatedAt: liveEntry.status === "active" ? Date.now() : liveEntry.activatedAt,
          };
          continue;
        }

        next.push({
          id: spray.id,
          spray,
          status: "queued",
        });
      }

      return promoteAndComplete(next);
    });
  }, [activities, enabled, feedReady]);

  useEffect(() => {
    if (!enabled) return;

    const timer = window.setInterval(() => {
      setEntries((prev) => promoteAndComplete(prev));
    }, 250);

    return () => window.clearInterval(timer);
  }, [enabled]);

  const activeSlots = entries
    .filter((entry) => entry.status === "active")
    .sort((a, b) => (a.slotIndex ?? 0) - (b.slotIndex ?? 0));

  const queuedSprays = entries
    .filter((entry) => entry.status === "queued")
    .sort((a, b) => a.spray.timestamp.getTime() - b.spray.timestamp.getTime());

  const slots: (SprayStageEntry | null)[] = Array.from({ length: STAGE_SLOT_COUNT }, (_, index) => {
    return activeSlots.find((entry) => entry.slotIndex === index) ?? null;
  });

  return {
    slots,
    queuedSprays,
    waitingCount: queuedSprays.length,
    onStageCount: activeSlots.length,
  };
}
