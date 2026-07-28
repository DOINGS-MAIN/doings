import { useCallback, useEffect, useState } from "react";
import { supabase } from "@/lib/supabase";
import { getAppUserId } from "@/lib/appUser";
import { STAGE_SLOT_COUNT } from "@/hooks/useSprayStage";

export function useSprayQueuePosition(
  eventId: string | undefined,
  holdId: string | null | undefined,
  enabled = true,
) {
  const [position, setPosition] = useState<number | null>(null);
  const [totalPending, setTotalPending] = useState(0);

  const refresh = useCallback(async () => {
    if (!eventId || !holdId || !enabled) {
      setPosition(null);
      setTotalPending(0);
      return;
    }

    const { data, error } = await supabase.rpc("get_event_live_spray_holds", {
      p_event_id: eventId,
    });

    if (error) {
      console.warn("Could not load spray queue position:", error.message);
      return;
    }

    const rows = (data as { hold_id: string }[]) ?? [];
    setTotalPending(rows.length);
    const idx = rows.findIndex((row) => row.hold_id === holdId);
    setPosition(idx >= 0 ? idx + 1 : null);
  }, [eventId, holdId, enabled]);

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

  const onProjector = position != null && position <= STAGE_SLOT_COUNT;

  return { position, totalPending, onProjector };
}
