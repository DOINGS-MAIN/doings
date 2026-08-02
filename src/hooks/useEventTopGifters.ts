import { useCallback, useEffect, useRef, useState } from "react";
import { publicProjector, supabase } from "@/lib/supabase";
import { debounceAsync } from "@/lib/debounceAsync";
import type { EventTopGifter } from "@/hooks/useEventSprayFeed";
import { mapTopGifterRow } from "@/hooks/useEventSprayFeed";

export interface UseEventTopGiftersOptions {
  publicViewer?: boolean;
  eventCode?: string;
  debounceMs?: number;
  pollIntervalMs?: number;
  limit?: number;
}

export function useEventTopGifters(
  eventId: string | undefined,
  enabled = true,
  options?: UseEventTopGiftersOptions,
) {
  const [topGifters, setTopGifters] = useState<EventTopGifter[]>([]);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const refreshRef = useRef<(showLoading?: boolean) => Promise<void>>(async () => {});

  const publicViewer = options?.publicViewer ?? false;
  const debounceMs = options?.debounceMs ?? (publicViewer ? 500 : 200);
  const pollIntervalMs = options?.pollIntervalMs ?? (publicViewer ? 12_000 : 0);
  const limit = options?.limit ?? 3;

  const refresh = useCallback(
    async (showLoading = false) => {
      if (!eventId || !enabled) {
        setTopGifters([]);
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
          setTopGifters((result.top_gifters ?? []).map(mapTopGifterRow));
          return;
        }

        const { data, error: rpcError } = await supabase.rpc("get_event_top_gifters", {
          p_event_id: eventId,
          p_limit: limit,
        });

        if (rpcError) {
          console.warn("Could not load event top gifters:", rpcError.message);
          setError(rpcError.message);
          return;
        }

        setTopGifters(((data as Record<string, unknown>[]) ?? []).map(mapTopGifterRow));
      } catch (err) {
        const message = err instanceof Error ? err.message : "Could not load top sprayers";
        console.warn("Could not load event top gifters:", message);
        setError(message);
      } finally {
        if (showLoading) setLoading(false);
      }
    },
    [eventId, enabled, publicViewer, options?.eventCode, limit],
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
      .channel(`event-top-gifters-${eventId}${publicViewer ? "-public" : ""}`)
      .on(
        "postgres_changes",
        {
          event: "INSERT",
          schema: "public",
          table: "spray_records",
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

  return { topGifters, loading, error, refresh: () => refresh(true) };
}
