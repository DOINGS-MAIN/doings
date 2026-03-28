import { useState, useEffect, useCallback } from "react";
import { supabase, events as eventsApi } from "@/lib/supabase";

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

function mapDbEvent(e: Record<string, unknown>): EventData {
  const typeStr = (e.type as string) ?? "other";
  const config = EVENT_TYPES_CONFIG[typeStr] ?? EVENT_TYPES_CONFIG.other;
  return {
    id: e.id as string,
    title: (e.title as string) ?? "",
    type: typeStr as EventData["type"],
    description: (e.description as string) ?? "",
    location: (e.location as string) ?? "",
    date: e.scheduled_start ? (e.scheduled_start as string).split("T")[0] : "",
    time: e.scheduled_start ? (e.scheduled_start as string).split("T")[1]?.slice(0, 5) ?? "" : "",
    hostId: (e.host_id as string) ?? "",
    hostName: (e.host_name as string) ?? "",
    status: (e.status as EventData["status"]) ?? "draft",
    participants: (e.participant_count as number) ?? 0,
    totalSprayed: ((e.total_sprayed as number) ?? 0) / 100,
    eventCode: (e.event_code as string) ?? "",
    isPrivate: !(e.is_public as boolean),
    maxParticipants: (e.max_participants as number) ?? undefined,
    emoji: config.emoji,
    gradient: config.gradient,
    createdAt: (e.created_at as string) ?? "",
    updatedAt: (e.updated_at as string) ?? "",
  };
}

export const useEvents = () => {
  const [allEvents, setAllEvents] = useState<EventData[]>([]);
  const [myEvents, setMyEvents] = useState<EventData[]>([]);

  const fetchEvents = useCallback(async () => {
    try {
      const data = await eventsApi.list() as Record<string, unknown>[];
      const mapped = (data ?? []).map(mapDbEvent);
      setAllEvents(mapped);
    } catch {
      // If the function isn't returning a list, try direct query
      const { data } = await supabase
        .from("events")
        .select("*, event_participants(count)")
        .order("created_at", { ascending: false })
        .limit(50);
      if (data) setAllEvents(data.map(mapDbEvent));
    }
  }, []);

  const fetchMyEvents = useCallback(async () => {
    const { data: { session } } = await supabase.auth.getSession();
    if (!session) return;

    const { data } = await supabase
      .from("events")
      .select("*")
      .eq("host_id", session.user.id)
      .order("created_at", { ascending: false });

    if (data) setMyEvents(data.map(mapDbEvent));
  }, []);

  useEffect(() => {
    fetchEvents();
    fetchMyEvents();

    const channel = supabase
      .channel("event-changes")
      .on("postgres_changes", { event: "*", schema: "public", table: "events" }, () => {
        fetchEvents();
        fetchMyEvents();
      })
      .subscribe();

    return () => { supabase.removeChannel(channel); };
  }, [fetchEvents, fetchMyEvents]);

  const createEvent = useCallback(
    async (eventData: Omit<EventData, "id" | "eventCode" | "participants" | "totalSprayed" | "createdAt" | "updatedAt" | "emoji" | "gradient">) => {
      const result = await eventsApi.create({
        title: eventData.title,
        type: eventData.type,
        scheduled_start: eventData.date && eventData.time ? `${eventData.date}T${eventData.time}:00` : undefined,
        is_public: !eventData.isPrivate,
        max_participants: eventData.maxParticipants,
      });
      await fetchEvents();
      await fetchMyEvents();

      const r = result as Record<string, unknown>;
      const config = EVENT_TYPES_CONFIG[eventData.type] ?? EVENT_TYPES_CONFIG.other;
      return {
        ...eventData,
        id: (r.id as string) ?? "",
        eventCode: (r.event_code as string) ?? "",
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
    return allEvents.find((e) => e.id === eventId) ?? null;
  }, [allEvents, fetchEvents, fetchMyEvents]);

  const endEvent = useCallback(async (eventId: string) => {
    await eventsApi.end(eventId);
    await fetchEvents();
    await fetchMyEvents();
    return allEvents.find((e) => e.id === eventId) ?? null;
  }, [allEvents, fetchEvents, fetchMyEvents]);

  const deleteEvent = useCallback(async (eventId: string) => {
    await eventsApi.delete(eventId);
    await fetchEvents();
    await fetchMyEvents();
  }, [fetchEvents, fetchMyEvents]);

  const joinEvent = useCallback(async (eventId: string) => {
    await eventsApi.join(eventId);
    await fetchEvents();
  }, [fetchEvents]);

  const addSprayAmount = useCallback((_eventId: string, _amount: number) => {
    // Spray amounts are updated via the spray edge function + realtime
  }, []);

  const findEventByCode = useCallback((code: string): EventData | undefined => {
    return allEvents.find((e) => e.eventCode.toUpperCase() === code.toUpperCase());
  }, [allEvents]);

  const getLiveEvents = useCallback((): EventData[] => {
    return allEvents.filter((e) => e.status === "live");
  }, [allEvents]);

  const getScheduledEvents = useCallback((): EventData[] => {
    return allEvents.filter((e) => e.status === "scheduled");
  }, [allEvents]);

  return {
    events: allEvents,
    myEvents,
    createEvent,
    updateEvent: async () => null,
    deleteEvent,
    goLive,
    endEvent,
    joinEvent,
    addSprayAmount,
    findEventByCode,
    getLiveEvents,
    getScheduledEvents,
  };
};

export { EVENT_TYPES_CONFIG };
