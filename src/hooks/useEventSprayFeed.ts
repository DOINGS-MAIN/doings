import { useCallback, useEffect, useRef, useState } from "react";
import { supabase } from "@/lib/supabase";
import { getAppUserId } from "@/lib/appUser";
import type { AvatarData } from "@/types/avatar";
import { avatarDataFromProfile } from "@/types/avatar";

export type EventSprayActivity = {
  id: string;
  name: string;
  username: string | null;
  avatarUrl: string | null;
  avatarData: AvatarData;
  avatar: string;
  amount: number;
  denomination: number;
  timestamp: Date;
};

export type EventTopGifter = {
  sprayerId: string;
  name: string;
  username: string | null;
  avatarUrl: string | null;
  avatarData: AvatarData;
  avatar: string;
  amount: number;
};

function displayAvatar(name: string, avatarUrl: string | null, hasPhoto: boolean): string {
  if (avatarUrl || hasPhoto) return "";
  const ch = name.trim().charAt(0);
  return ch ? ch.toUpperCase() : "👤";
}

function mapFeedRow(row: Record<string, unknown>): EventSprayActivity {
  const name = String(row.sprayer_name ?? "Guest");
  const avatarUrl = (row.sprayer_avatar_url as string | null) ?? null;
  const avatarData = avatarDataFromProfile(row.sprayer_avatar_data, avatarUrl);
  return {
    id: String(row.id),
    name,
    username: (row.sprayer_username as string | null) ?? null,
    avatarUrl,
    avatarData,
    avatar: displayAvatar(name, avatarUrl, Boolean(avatarData.photoUrl)),
    amount: Number(row.amount ?? 0) / 100,
    denomination: Number(row.denomination ?? 0),
    timestamp: new Date(String(row.sprayed_at ?? Date.now())),
  };
}

function mapTopGifterRow(row: Record<string, unknown>): EventTopGifter {
  const name = String(row.sprayer_name ?? "Guest");
  const avatarUrl = (row.sprayer_avatar_url as string | null) ?? null;
  const avatarData = avatarDataFromProfile(row.sprayer_avatar_data, avatarUrl);
  return {
    sprayerId: String(row.sprayer_id),
    name,
    username: (row.sprayer_username as string | null) ?? null,
    avatarUrl,
    avatarData,
    avatar: displayAvatar(name, avatarUrl, Boolean(avatarData.photoUrl)),
    amount: Number(row.total_amount ?? 0) / 100,
  };
}

export function useEventSprayFeed(eventId: string | undefined, enabled = true) {
  const [activities, setActivities] = useState<EventSprayActivity[]>([]);
  const [topGifters, setTopGifters] = useState<EventTopGifter[]>([]);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const refresh = useCallback(async () => {
    if (!eventId || !enabled) return;
    setLoading(true);
    setError(null);
    try {
      const [feedRes, topRes] = await Promise.all([
        supabase.rpc("get_event_spray_feed", { p_event_id: eventId, p_limit: 50 }),
        supabase.rpc("get_event_top_gifters", { p_event_id: eventId, p_limit: 3 }),
      ]);

      if (feedRes.error) throw feedRes.error;
      if (topRes.error) throw topRes.error;

      setActivities(((feedRes.data as Record<string, unknown>[]) ?? []).map(mapFeedRow));
      setTopGifters(((topRes.data as Record<string, unknown>[]) ?? []).map(mapTopGifterRow));
    } catch (err) {
      setError(err instanceof Error ? err.message : "Could not load spray activity");
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
        .channel(`event-sprays-${eventId}`)
        .on(
          "postgres_changes",
          { event: "INSERT", schema: "public", table: "spray_records", filter: `event_id=eq.${eventId}` },
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

  return { activities, topGifters, loading, error, refresh };
}
