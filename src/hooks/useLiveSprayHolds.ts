import { useCallback, useEffect, useState } from "react";
import { supabase } from "@/lib/supabase";
import { getAppUserId } from "@/lib/appUser";
import type { EventSprayActivity } from "@/hooks/useEventSprayFeed";
import { avatarDataFromProfile } from "@/types/avatar";

function displayAvatar(name: string, avatarUrl: string | null, hasPhoto: boolean): string {
  if (avatarUrl || hasPhoto) return "";
  const ch = name.trim().charAt(0);
  return ch ? ch.toUpperCase() : "👤";
}

function mapHoldRow(row: Record<string, unknown>): EventSprayActivity {
  const holdId = String(row.hold_id);
  const name = String(row.sprayer_name ?? "Guest");
  const avatarUrl = (row.sprayer_avatar_url as string | null) ?? null;
  const avatarData = avatarDataFromProfile(row.sprayer_avatar_data, avatarUrl);
  return {
    id: `live-${holdId}`,
    holdId,
    name,
    username: (row.sprayer_username as string | null) ?? null,
    avatarUrl,
    avatarData,
    avatar: displayAvatar(name, avatarUrl, Boolean(avatarData.photoUrl)),
    amount: Number(row.planned_amount ?? 0) / 100,
    denomination: Number(row.denomination ?? 0),
    timestamp: new Date(String(row.created_at ?? Date.now())),
    isLive: true,
  };
}

export function useLiveSprayHolds(eventId: string | undefined, enabled = true) {
  const [liveSprays, setLiveSprays] = useState<EventSprayActivity[]>([]);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const refresh = useCallback(async () => {
    if (!eventId || !enabled) {
      setLiveSprays([]);
      setLoading(false);
      setError(null);
      return;
    }

    setLoading(true);
    setError(null);
    try {
      const { data, error: rpcError } = await supabase.rpc("get_event_live_spray_holds", {
        p_event_id: eventId,
      });

      if (rpcError) {
        console.warn("Could not load live spray holds:", rpcError.message);
        setError(rpcError.message);
        return;
      }

      setLiveSprays(((data as Record<string, unknown>[]) ?? []).map(mapHoldRow));
    } finally {
      setLoading(false);
    }
  }, [eventId, enabled]);

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
        .channel(`event-live-sprays-${eventId}`)
        .on(
          "postgres_changes",
          {
            event: "INSERT",
            schema: "public",
            table: "spray_holds",
            filter: `event_id=eq.${eventId}`,
          },
          () => {
            void refresh();
          },
        )
        .on(
          "postgres_changes",
          {
            event: "UPDATE",
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
  }, [eventId, enabled, refresh]);

  return { liveSprays, loading, error, refresh };
}
