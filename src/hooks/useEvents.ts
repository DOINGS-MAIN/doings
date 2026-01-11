import { useState, useEffect } from "react";

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

interface EventsState {
  events: EventData[];
  myEvents: EventData[];
}

const EVENT_TYPES_CONFIG = {
  wedding: { emoji: "💒", gradient: "from-pink-500 to-rose-600" },
  birthday: { emoji: "🎂", gradient: "from-amber-500 to-orange-600" },
  party: { emoji: "🎉", gradient: "from-violet-500 to-purple-600" },
  graduation: { emoji: "🎓", gradient: "from-blue-500 to-indigo-600" },
  funeral: { emoji: "🕊️", gradient: "from-gray-500 to-slate-600" },
  naming: { emoji: "👶", gradient: "from-cyan-500 to-teal-600" },
  other: { emoji: "✨", gradient: "from-primary to-accent" },
};

const generateEventCode = (): string => {
  const chars = "ABCDEFGHIJKLMNOPQRSTUVWXYZ0123456789";
  let code = "";
  for (let i = 0; i < 6; i++) {
    code += chars.charAt(Math.floor(Math.random() * chars.length));
  }
  return code;
};

const getInitialState = (): EventsState => {
  try {
    const saved = localStorage.getItem("doings_events");
    if (saved) {
      return JSON.parse(saved);
    }
  } catch (error) {
    console.error("Failed to load events from localStorage:", error);
  }

  // Demo events
  return {
    events: [
      {
        id: "demo-1",
        title: "Ade & Bimpe Wedding",
        type: "wedding",
        description: "Join us to celebrate our special day!",
        location: "Lagos, Nigeria",
        date: new Date().toISOString().split("T")[0],
        time: "14:00",
        hostId: "host-1",
        hostName: "Ade & Bimpe",
        status: "live",
        participants: 234,
        totalSprayed: 1500000,
        eventCode: "ADEBIM",
        isPrivate: false,
        emoji: "💒",
        gradient: "from-pink-500 to-rose-600",
        createdAt: new Date().toISOString(),
        updatedAt: new Date().toISOString(),
      },
      {
        id: "demo-2",
        title: "Tech Summit Afterparty",
        type: "party",
        description: "Celebrating innovation!",
        location: "Victoria Island",
        date: new Date().toISOString().split("T")[0],
        time: "20:00",
        hostId: "host-2",
        hostName: "TechNG",
        status: "scheduled",
        participants: 89,
        totalSprayed: 0,
        eventCode: "TECHVIP",
        isPrivate: false,
        emoji: "🎉",
        gradient: "from-violet-500 to-purple-600",
        createdAt: new Date().toISOString(),
        updatedAt: new Date().toISOString(),
      },
      {
        id: "demo-3",
        title: "Chief's Birthday Bash",
        type: "birthday",
        description: "Chief Okonkwo turns 60!",
        location: "Abuja",
        date: new Date().toISOString().split("T")[0],
        time: "16:00",
        hostId: "host-3",
        hostName: "Chief Okonkwo Family",
        status: "live",
        participants: 156,
        totalSprayed: 2300000,
        eventCode: "CHIEF60",
        isPrivate: false,
        emoji: "🎂",
        gradient: "from-amber-500 to-orange-600",
        createdAt: new Date().toISOString(),
        updatedAt: new Date().toISOString(),
      },
    ],
    myEvents: [],
  };
};

export const useEvents = () => {
  const [state, setState] = useState<EventsState>(getInitialState);

  useEffect(() => {
    localStorage.setItem("doings_events", JSON.stringify(state));
  }, [state]);

  const createEvent = (
    eventData: Omit<EventData, "id" | "eventCode" | "participants" | "totalSprayed" | "createdAt" | "updatedAt" | "emoji" | "gradient">
  ): EventData => {
    const typeConfig = EVENT_TYPES_CONFIG[eventData.type];
    const newEvent: EventData = {
      ...eventData,
      id: `event-${Date.now()}`,
      eventCode: generateEventCode(),
      participants: 0,
      totalSprayed: 0,
      emoji: typeConfig.emoji,
      gradient: typeConfig.gradient,
      createdAt: new Date().toISOString(),
      updatedAt: new Date().toISOString(),
    };

    setState((prev) => ({
      ...prev,
      events: [newEvent, ...prev.events],
      myEvents: [newEvent, ...prev.myEvents],
    }));

    return newEvent;
  };

  const updateEvent = (eventId: string, updates: Partial<EventData>): EventData | null => {
    let updatedEvent: EventData | null = null;

    setState((prev) => {
      const updateEventInList = (events: EventData[]) =>
        events.map((event) => {
          if (event.id === eventId) {
            updatedEvent = {
              ...event,
              ...updates,
              updatedAt: new Date().toISOString(),
            };
            return updatedEvent;
          }
          return event;
        });

      return {
        events: updateEventInList(prev.events),
        myEvents: updateEventInList(prev.myEvents),
      };
    });

    return updatedEvent;
  };

  const deleteEvent = (eventId: string): void => {
    setState((prev) => ({
      events: prev.events.filter((e) => e.id !== eventId),
      myEvents: prev.myEvents.filter((e) => e.id !== eventId),
    }));
  };

  const goLive = (eventId: string): EventData | null => {
    return updateEvent(eventId, { status: "live" });
  };

  const endEvent = (eventId: string): EventData | null => {
    return updateEvent(eventId, { status: "ended" });
  };

  const joinEvent = (eventId: string): void => {
    setState((prev) => ({
      ...prev,
      events: prev.events.map((event) =>
        event.id === eventId
          ? { ...event, participants: event.participants + 1 }
          : event
      ),
    }));
  };

  const addSprayAmount = (eventId: string, amount: number): void => {
    setState((prev) => ({
      ...prev,
      events: prev.events.map((event) =>
        event.id === eventId
          ? { ...event, totalSprayed: event.totalSprayed + amount }
          : event
      ),
      myEvents: prev.myEvents.map((event) =>
        event.id === eventId
          ? { ...event, totalSprayed: event.totalSprayed + amount }
          : event
      ),
    }));
  };

  const findEventByCode = (code: string): EventData | undefined => {
    return state.events.find(
      (event) => event.eventCode.toUpperCase() === code.toUpperCase()
    );
  };

  const getLiveEvents = (): EventData[] => {
    return state.events.filter((event) => event.status === "live");
  };

  const getScheduledEvents = (): EventData[] => {
    return state.events.filter((event) => event.status === "scheduled");
  };

  return {
    events: state.events,
    myEvents: state.myEvents,
    createEvent,
    updateEvent,
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
