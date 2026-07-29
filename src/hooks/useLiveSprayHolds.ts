import { useCallback, useEffect, useRef, useState } from "react";
import { publicProjector, supabase } from "@/lib/supabase";
import { debounceAsync } from "@/lib/debounceAsync";
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

export interface UseLiveSprayHoldsOptions {
  /** Use rate-limited edge function instead of direct RPC (anonymous public viewers). */
  publicViewer?: boolean;
  eventCode?: string;
  debounceMs?: number;
  /** Fallback poll when Realtime misses an update (public viewers only). */
  pollIntervalMs?: number;
}

export function useLiveSprayHolds(
  eventId: string | undefined,
  enabled = true,
  options?: UseLiveSprayHoldsOptions,
) {
  const [liveSprays, setLiveSprays] = useState<EventSprayActivity[]>([]);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const refreshRef = useRef<(showLoading?: boolean) => Promise<void>>(async () => {});

  const publicViewer = options?.publicViewer ?? false;
  const debounceMs = options?.debounceMs ?? (publicViewer ? 500 : 200);
  const pollIntervalMs = options?.pollIntervalMs ?? (publicViewer ? 8_000 : 0);

  const refresh = useCallback(
    async (showLoading = true) => {
      if (!eventId || !enabled) {
        setLiveSprays([]);
        setLoading(false);
        setError(null);
        return;
      }

      if (showLoading) setLoading(true);
      setError(null);
      try {
        if (publicViewer) {
          const result = await publicProjector.getLiveSprays({
            eventId,
            eventCode: options?.eventCode,
          });
          setLiveSprays((result.live_sprays ?? []).map(mapHoldRow));
          return;
        }

        const { data, error: rpcError } = await supabase.rpc("get_event_live_spray_holds", {
          p_event_id: eventId,
        });

        if (rpcError) {
          console.warn("Could not load live spray holds:", rpcError.message);
          setError(rpcError.message);
          return;
        }

        setLiveSprays(((data as Record<string, unknown>[]) ?? []).map(mapHoldRow));
      } catch (err) {
        const message = err instanceof Error ? err.message : "Could not load live sprays";
        console.warn("Could not load live spray holds:", message);
        setError(message);
      } finally {
        if (showLoading) setLoading(false);
      }
    },
    [eventId, enabled, publicViewer, options?.eventCode],
  );

  refreshRef.current = refresh;

  useEffect(() => {
    void refresh(true);
  }, [refresh]);

  useEffect(() => {
    if (!eventId || !enabled) return;

    const debouncedRefresh = debounceAsync(() => {
      void refreshRef.current(false);
    }, debounceMs);

    const channel = supabase
      .channel(`event-live-sprays-${eventId}${publicViewer ? "-public" : ""}`)
      .on(
        "postgres_changes",
        {
          event: "INSERT",
          schema: "public",
          table: "spray_holds",
          filter: `event_id=eq.${eventId}`,
        },
        () => {
          debouncedRefresh();
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
          debouncedRefresh();
        },
      )
      .subscribe();

    return () => {
      debouncedRefresh.cancel();
      supabase.removeChannel(channel);
    };
  }, [eventId, enabled, debounceMs, publicViewer]);

  useEffect(() => {
    if (!eventId || !enabled || pollIntervalMs <= 0) return;

    const timer = window.setInterval(() => {
      void refreshRef.current(false);
    }, pollIntervalMs);

    return () => window.clearInterval(timer);
  }, [eventId, enabled, pollIntervalMs]);

  return { liveSprays, loading, error, refresh: () => refresh(true) };
}
