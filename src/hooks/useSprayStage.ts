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

export function useSprayStage(
  eventId: string | undefined,
  activities: EventSprayActivity[],
  enabled = true,
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
      const merged = [
        ...prev,
        ...newSprays.map((spray) => ({
          id: spray.id,
          spray,
          status: "queued" as const,
        })),
      ];
      return promoteAndComplete(merged);
    });
  }, [activities, enabled]);

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
