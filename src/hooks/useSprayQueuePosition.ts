import { useCallback, useEffect, useState } from "react";
import { supabase } from "@/lib/supabase";
import { getAppUserId } from "@/lib/appUser";
import { STAGE_SLOT_COUNT } from "@/hooks/useSprayStage";

type QueueRow = {
  hold_id: string;
  is_paused: boolean;
};

export function useSprayQueuePosition(
  eventId: string | undefined,
  holdId: string | null | undefined,
  enabled = true,
  isPausedLocally = false,
) {
  const [position, setPosition] = useState<number | null>(null);
  const [totalActive, setTotalActive] = useState(0);

  const refresh = useCallback(async () => {
    if (!eventId || !holdId || !enabled) {
      setPosition(null);
      setTotalActive(0);
      return;
    }

    const { data, error } = await supabase.rpc("get_event_spray_queue_holds", {
      p_event_id: eventId,
    });

    if (error) {
      console.warn("Could not load spray queue position:", error.message);
      return;
    }

    const rows = (data as QueueRow[]) ?? [];
    const activeRows = rows.filter((row) => !row.is_paused);
    setTotalActive(activeRows.length);

    if (isPausedLocally) {
      setPosition(null);
      return;
    }

    const idx = activeRows.findIndex((row) => row.hold_id === holdId);
    setPosition(idx >= 0 ? idx + 1 : null);
  }, [eventId, holdId, enabled, isPausedLocally]);

  useEffect(() => {
    void refresh();
  }, [refresh]);

  useEffect(() => {
    if (!eventId || !enabled) return;

    let channel: ReturnType<typeof supabase.channel> | null = null;

    const setup = async () => {
      const appUserId = await getAppUserId();
      if (!appUserId) return;

      channel = supabase
        .channel(`spray-queue-pos-${eventId}-${holdId ?? "none"}`)
        .on(
          "postgres_changes",
          {
            event: "*",
            schema: "public",
            table: "spray_holds",
            filter: `event_id=eq.${eventId}`,
          },
          () => {
            void refresh();
          },
        )
        .subscribe();
    };

    void setup();

    return () => {
      if (channel) supabase.removeChannel(channel);
    };
  }, [eventId, holdId, enabled, refresh]);

  const onProjector = !isPausedLocally && position != null && position <= STAGE_SLOT_COUNT;

  return { position, totalActive, onProjector, isPausedLocally };
}
