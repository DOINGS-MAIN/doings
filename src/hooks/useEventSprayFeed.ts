import { useCallback, useEffect, useRef, useState } from "react";
import { supabase } from "@/lib/supabase";
import { debounceAsync } from "@/lib/debounceAsync";
import type { AvatarData } from "@/types/avatar";
import { avatarDataFromProfile } from "@/types/avatar";

export type EventSprayActivity = {
  id: string;
  holdId?: string;
  name: string;
  username: string | null;
  avatarUrl: string | null;
  avatarData: AvatarData;
  avatar: string;
  amount: number;
  denomination: number;
  timestamp: Date;
  /** Guest is actively spraying — projector preview before settlement. */
  isLive?: boolean;
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
    holdId: row.hold_id ? String(row.hold_id) : undefined,
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

export function mapTopGifterRow(row: Record<string, unknown>): EventTopGifter {
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
  const [feedReady, setFeedReady] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const refreshRef = useRef<() => Promise<void>>(async () => {});

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
      setFeedReady(true);
    } catch (err) {
      setError(err instanceof Error ? err.message : "Could not load spray activity");
    } finally {
      setLoading(false);
    }
  }, [eventId, enabled]);

  refreshRef.current = refresh;

  useEffect(() => {
    setFeedReady(false);
  }, [eventId]);

  useEffect(() => {
    void refresh();
  }, [refresh]);

  useEffect(() => {
    if (!eventId || !enabled) return;

    const debouncedRefresh = debounceAsync(() => {
      void refreshRef.current();
    }, 250);

    const channel = supabase
      .channel(`event-sprays-${eventId}`)
      .on(
        "postgres_changes",
        { event: "INSERT", schema: "public", table: "spray_records", filter: `event_id=eq.${eventId}` },
        () => {
          debouncedRefresh();
        },
      )
      .subscribe();

    return () => {
      debouncedRefresh.cancel();
      supabase.removeChannel(channel);
    };
  }, [eventId, enabled]);

  return { activities, topGifters, loading, feedReady, error, refresh };
}
