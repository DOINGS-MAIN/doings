import { supabase } from "@/lib/supabase";
import { mapDbEvent, type EventData } from "@/hooks/useEvents";

const PROJECTOR_EVENT_COLUMNS =
  "id, title, type, description, location, event_date, event_time, scheduled_at, status, participant_count, total_sprayed, event_code, is_private, host_id, created_at, updated_at";

/** Load event metadata for the projector (respects RLS — public live or host). */
export async function fetchProjectorEvent(eventId: string): Promise<EventData | null> {
  const { data, error } = await supabase
    .from("events")
    .select(PROJECTOR_EVENT_COLUMNS)
    .eq("id", eventId)
    .maybeSingle();

  if (error) {
    console.warn("Could not load projector event:", error.message);
    return null;
  }
  if (!data) return null;
  return mapDbEvent(data as Record<string, unknown>);
}

/** Resolve a public live event by 6-char code (anon-safe via RLS). */
export async function fetchProjectorEventByCode(eventCode: string): Promise<EventData | null> {
  const code = eventCode.trim().toUpperCase();
  if (!code) return null;

  const { data, error } = await supabase
    .from("events")
    .select(PROJECTOR_EVENT_COLUMNS)
    .eq("event_code", code)
    .maybeSingle();

  if (error) {
    console.warn("Could not load projector event by code:", error.message);
    return null;
  }
  if (!data) return null;
  return mapDbEvent(data as Record<string, unknown>);
}
