import { useState, useEffect, useCallback, useRef } from "react";
import { supabase, events as eventsApi } from "@/lib/supabase";
import { getAppUserId } from "@/lib/appUser";
import { debounceAsync } from "@/lib/debounceAsync";

export interface EventData {
  id: string;
  title: string;
  type: "wedding" | "birthday" | "party" | "graduation" | "funeral" | "naming" | "other";
  description: string;
  location: string;
  date: string;
  time: string;
  hostId: string;
  hostName: string;
  status: "draft" | "scheduled" | "live" | "ended";
  participants: number;
  totalSprayed: number;
  eventCode: string;
  isPrivate: boolean;
  maxParticipants?: number;
  emoji: string;
  gradient: string;
  createdAt: string;
  updatedAt: string;
}

const EVENT_TYPES_CONFIG: Record<string, { emoji: string; gradient: string }> = {
  wedding: { emoji: "💒", gradient: "from-pink-500 to-rose-600" },
  birthday: { emoji: "🎂", gradient: "from-amber-500 to-orange-600" },
  party: { emoji: "🎉", gradient: "from-violet-500 to-purple-600" },
  graduation: { emoji: "🎓", gradient: "from-blue-500 to-indigo-600" },
  funeral: { emoji: "🕊️", gradient: "from-gray-500 to-slate-600" },
  naming: { emoji: "👶", gradient: "from-cyan-500 to-teal-600" },
  other: { emoji: "✨", gradient: "from-primary to-accent" },
};

export function mapDbEvent(e: Record<string, unknown>): EventData {
  const typeStr = (e.type as string) ?? "other";
  const config = EVENT_TYPES_CONFIG[typeStr] ?? EVENT_TYPES_CONFIG.other;
  return {
    id: e.id as string,
    title: (e.title as string) ?? "",
    type: typeStr as EventData["type"],
    description: (e.description as string) ?? "",
    location: (e.location as string) ?? "",
    date: (() => {
      const at = (e.scheduled_at as string) || (e.scheduled_start as string);
      if (at) return at.split("T")[0] ?? "";
      return ((e.event_date as string) ?? "");
    })(),
    time: (() => {
      const at = (e.scheduled_at as string) || (e.scheduled_start as string);
      if (at) return at.split("T")[1]?.slice(0, 5) ?? "";
      const t = (e.event_time as string) ?? "";
      return t.length >= 5 ? t.slice(0, 5) : t;
    })(),
    hostId: (e.host_id as string) ?? "",
    hostName: (e.host_name as string) ?? "",
    status: (e.status as EventData["status"]) ?? "draft",
    participants: (e.participant_count as number) ?? 0,
    totalSprayed: ((e.total_sprayed as number) ?? 0) / 100,
    eventCode: (e.event_code as string) ?? "",
    isPrivate:
      typeof e.is_private === "boolean"
        ? e.is_private
        : typeof e.is_public === "boolean"
          ? !e.is_public
          : false,
    maxParticipants:
      e.max_participants != null && Number(e.max_participants) > 0
        ? Number(e.max_participants)
        : undefined,
    emoji: config.emoji,
    gradient: config.gradient,
    createdAt: (e.created_at as string) ?? "",
    updatedAt: (e.updated_at as string) ?? "",
  };
}

export const useEvents = () => {
  const [allEvents, setAllEvents] = useState<EventData[]>([]);
  const [myEvents, setMyEvents] = useState<EventData[]>([]);
  /** Live events the user hosts or has joined (for event giveaways). */
  const [liveEventsForGiveaway, setLiveEventsForGiveaway] = useState<EventData[]>([]);
  /** True until the first `fetchMyEvents` run finishes (avoids empty-state flash on /events). */
  const [myEventsInitialLoading, setMyEventsInitialLoading] = useState(true);
  const myEventsFirstFetchDone = useRef(false);

  const fetchEvents = useCallback(async () => {
    try {
      const res = (await eventsApi.list()) as
        | { events?: Record<string, unknown>[] }
        | Record<string, unknown>[];
      const rows = Array.isArray(res) ? res : res.events;
      const list = Array.isArray(rows) ? rows : [];
      setAllEvents(list.map(mapDbEvent));
    } catch {
      const { data } = await supabase
        .from("events")
        .select("*")
        .eq("is_private", false)
        .order("created_at", { ascending: false })
        .limit(50);
      if (data) setAllEvents(data.map(mapDbEvent));
    }
  }, []);

  const fetchLiveEventsForGiveaway = useCallback(async () => {
    try {
      const { data, error } = await supabase.rpc("get_my_live_events_for_giveaway");
      if (error) throw error;
      const rows = Array.isArray(data) ? data : [];
      setLiveEventsForGiveaway(rows.map((row) => mapDbEvent(row as Record<string, unknown>)));
    } catch {
      try {
        const appUserId = await getAppUserId();
        if (!appUserId) {
          setLiveEventsForGiveaway([]);
          return;
        }
        const { data } = await supabase
          .from("events")
          .select("*")
          .eq("host_id", appUserId)
          .eq("status", "live");
        setLiveEventsForGiveaway((data ?? []).map(mapDbEvent));
      } catch {
        setLiveEventsForGiveaway([]);
      }
    }
  }, []);

  const fetchMyEvents = useCallback(async () => {
    const isInitial = !myEventsFirstFetchDone.current;
    try {
      const appUserId = await getAppUserId();
      if (!appUserId) {
        setMyEvents([]);
        return;
      }

      const { data } = await supabase
        .from("events")
        .select("*")
        .eq("host_id", appUserId)
        .order("created_at", { ascending: false });

      if (data) setMyEvents(data.map(mapDbEvent));
      else setMyEvents([]);
    } catch {
      setMyEvents([]);
    } finally {
      if (isInitial) {
        myEventsFirstFetchDone.current = true;
        setMyEventsInitialLoading(false);
      }
    }
  }, []);

  useEffect(() => {
    void fetchEvents();
    void fetchMyEvents();
    void fetchLiveEventsForGiveaway();

    const debouncedSync = debounceAsync(() => {
      void fetchEvents();
      void fetchMyEvents();
      void fetchLiveEventsForGiveaway();
    }, 250);

    const channel = supabase
      .channel("event-changes")
      .on("postgres_changes", { event: "*", schema: "public", table: "events" }, () => {
        debouncedSync();
      })
      .on("postgres_changes", { event: "*", schema: "public", table: "event_participants" }, () => {
        debouncedSync();
      })
      .subscribe();

    return () => {
      debouncedSync.cancel();
      supabase.removeChannel(channel);
    };
  }, [fetchEvents, fetchMyEvents, fetchLiveEventsForGiveaway]);

  const createEvent = useCallback(
    async (eventData: Omit<EventData, "id" | "eventCode" | "participants" | "totalSprayed" | "createdAt" | "updatedAt" | "emoji" | "gradient">) => {
      const result = (await eventsApi.create({
        title: eventData.title,
        type: eventData.type,
        description: eventData.description,
        location: eventData.location,
        scheduled_start: eventData.date && eventData.time ? `${eventData.date}T${eventData.time}:00` : undefined,
        is_public: !eventData.isPrivate,
        ...(eventData.maxParticipants != null &&
        Number.isFinite(eventData.maxParticipants) &&
        eventData.maxParticipants > 0
          ? { max_participants: Math.floor(eventData.maxParticipants) }
          : {}),
      })) as { ok?: boolean; event?: Record<string, unknown> };

      const ev = result.event;
      if (!ev?.id) throw new Error("Server did not return an event. Try again.");

      await fetchEvents();
      await fetchMyEvents();

      const config = EVENT_TYPES_CONFIG[eventData.type] ?? EVENT_TYPES_CONFIG.other;
      return {
        ...eventData,
        id: ev.id as string,
        eventCode: (ev.event_code as string) ?? "",
        participants: 0,
        totalSprayed: 0,
        emoji: config.emoji,
        gradient: config.gradient,
        createdAt: new Date().toISOString(),
        updatedAt: new Date().toISOString(),
      } as EventData;
    },
    [fetchEvents, fetchMyEvents]
  );

  const goLive = useCallback(async (eventId: string) => {
    await eventsApi.goLive(eventId);
    await fetchEvents();
    await fetchMyEvents();
    await fetchLiveEventsForGiveaway();
    return allEvents.find((e) => e.id === eventId) ?? null;
  }, [allEvents, fetchEvents, fetchMyEvents, fetchLiveEventsForGiveaway]);

  const endEvent = useCallback(async (eventId: string) => {
    await eventsApi.end(eventId);
    await fetchEvents();
    await fetchMyEvents();
    await fetchLiveEventsForGiveaway();
    return allEvents.find((e) => e.id === eventId) ?? null;
  }, [allEvents, fetchEvents, fetchMyEvents, fetchLiveEventsForGiveaway]);

  const deleteEvent = useCallback(async (eventId: string) => {
    await eventsApi.delete(eventId);
    await fetchEvents();
    await fetchMyEvents();
  }, [fetchEvents, fetchMyEvents]);

  const updateEvent = useCallback(
    async (eventId: string, body: Record<string, unknown>): Promise<EventData | null> => {
      const result = (await eventsApi.update(eventId, body)) as { ok?: boolean; event?: Record<string, unknown> };
      if (!result.event?.id) throw new Error("Server did not return the updated event.");
      const mapped = mapDbEvent(result.event);
      await fetchEvents();
      await fetchMyEvents();
      return mapped;
    },
    [fetchEvents, fetchMyEvents]
  );

  const joinEvent = useCallback(async (eventId: string) => {
    await eventsApi.join(eventId);
    await fetchEvents();
    await fetchLiveEventsForGiveaway();
  }, [fetchEvents, fetchLiveEventsForGiveaway]);

  const addSprayAmount = useCallback((_eventId: string, _amount: number) => {
    // Spray amounts are updated via the spray edge function + realtime
  }, []);

  const findEventByCode = useCallback(
    async (code: string): Promise<EventData | undefined> => {
      const upper = code.trim().toUpperCase();
      const local = allEvents.find((e) => e.eventCode.toUpperCase() === upper);
      if (local) return local;
      try {
        const res = (await eventsApi.getByCode(code.trim())) as { event?: Record<string, unknown> };
        if (res.event?.id) return mapDbEvent(res.event);
      } catch {
        return undefined;
      }
      return undefined;
    },
    [allEvents]
  );

  /** Public live events for browse / join (excludes private even if cached client-side). */
  const getLiveEvents = useCallback((): EventData[] => {
    return allEvents.filter((e) => e.status === "live" && !e.isPrivate);
  }, [allEvents]);

  /** Host's live events, including private (e.g. attach giveaway to your private party). */
  const getMyLiveEvents = useCallback((): EventData[] => {
    return myEvents.filter((e) => e.status === "live");
  }, [myEvents]);

  /** Live events the user hosts or has joined — for attaching giveaways at an event. */
  const getLiveEventsForGiveaway = useCallback((): EventData[] => {
    return liveEventsForGiveaway;
  }, [liveEventsForGiveaway]);

  const getScheduledEvents = useCallback((): EventData[] => {
    return allEvents.filter((e) => e.status === "scheduled");
  }, [allEvents]);

  return {
    events: allEvents,
    myEvents,
    myEventsInitialLoading,
    createEvent,
    updateEvent,
    deleteEvent,
    goLive,
    endEvent,
    joinEvent,
    addSprayAmount,
    findEventByCode,
    getLiveEvents,
    getMyLiveEvents,
    getLiveEventsForGiveaway,
    getScheduledEvents,
  };
};

export { EVENT_TYPES_CONFIG };
