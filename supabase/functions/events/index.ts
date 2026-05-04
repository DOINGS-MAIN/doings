import { corsHeaders, withCors } from "../_shared/cors.ts";
import { getAuthUserIdFromRequest, getServiceClient } from "../_shared/db.ts";

/** Path after the function name (e.g. `uuid`, `code/ABC`, `uuid/join`). Gateway uses `/functions/v1/events/...`. */
function eventsPathTail(reqUrl: string): string {
  const parts = new URL(reqUrl).pathname.split("/").filter(Boolean);
  const i = parts.indexOf("events");
  if (i === -1) return "";
  return parts.slice(i + 1).join("/");
}

Deno.serve(async (req) => {
  if (req.method === "OPTIONS") return new Response("ok", { headers: corsHeaders });

  const url = new URL(req.url);
  const path = eventsPathTail(req.url).replace(/\/$/, "");
  const method = req.method;

  const authHeader = req.headers.get("Authorization");
  if (!authHeader) return withCors({ error: "Missing authorization" }, { status: 401 });

  const authUserId = await getAuthUserIdFromRequest(authHeader);
  if (!authUserId) return withCors({ error: "Unauthorized" }, { status: 401 });

  const supabase = getServiceClient();
  const { data: user, error: userErr } = await supabase
    .from("users")
    .select("id")
    .eq("auth_id", authUserId)
    .single();
  if (userErr || !user) return withCors({ error: "User not found" }, { status: 404 });

  // POST / — create event
  // - `is_private`: not listed in GET / (public feed); guests still join via code (GET /code/:code) or direct id.
  // - `event_code`: DB trigger `generate_event_code()` assigns a unique 6-char code if omitted.
  // - `max_participants`: NULL = unlimited; integer > 0 = cap (enforced on POST /:id/join).
  if (method === "POST" && !path) {
    const body = (await req.json()) as Record<string, unknown>;
    let event_date: string | null = (body.event_date as string) ?? null;
    let event_time: string | null = (body.event_time as string) ?? null;
    let scheduled_at: string | null = (body.scheduled_at as string) ?? null;
    const scheduledStart = body.scheduled_start as string | undefined;
    if (scheduledStart) {
      const d = new Date(scheduledStart);
      if (!Number.isNaN(d.getTime())) {
        scheduled_at = d.toISOString();
        const [datePart, timePart] = scheduledStart.split("T");
        if (datePart) event_date = datePart;
        if (timePart) event_time = timePart.split(".")[0].slice(0, 8);
      }
    }
    const is_private =
      typeof body.is_public === "boolean" ? !body.is_public : Boolean(body.is_private);

    const rawMax = body.max_participants;
    let max_participants: number | null = null;
    if (typeof rawMax === "number" && Number.isFinite(rawMax) && rawMax > 0) {
      max_participants = Math.floor(rawMax);
    }

    const { data: event, error } = await supabase
      .from("events")
      .insert({
        host_id: user.id,
        title: body.title as string,
        type: body.type as string,
        description: (body.description as string) ?? null,
        location: (body.location as string) ?? null,
        event_date,
        event_time,
        scheduled_at,
        is_private,
        max_participants,
      })
      .select()
      .single();

    if (error) return withCors({ error: "Failed to create event", detail: String(error) }, { status: 500 });

    await supabase.from("event_participants").insert({
      event_id: event.id,
      user_id: user.id,
      role: "host",
    });

    return withCors({ ok: true, event });
  }

  // GET / — list public events
  if (method === "GET" && !path) {
    const page = Number(url.searchParams.get("page") ?? "1");
    const limit = Math.min(Number(url.searchParams.get("limit") ?? "20"), 50);
    const offset = (page - 1) * limit;

    const { data: events, error } = await supabase
      .from("events")
      .select("id, title, type, event_date, event_time, location, status, participant_count, total_sprayed, event_code, is_private, host_id")
      .eq("is_private", false)
      .order("created_at", { ascending: false })
      .range(offset, offset + limit - 1);

    if (error) return withCors({ error: "Failed to list events" }, { status: 500 });
    return withCors({ events, page, limit });
  }

  // Routes with an event identifier: code/:code, :id, :id/join, :id/go-live, :id/end
  const codeMatch = path.match(/^code\/([A-Za-z0-9]+)$/);
  if (method === "GET" && codeMatch) {
    const code = codeMatch[1].toUpperCase();
    const { data: event, error } = await supabase
      .from("events")
      .select("*")
      .eq("event_code", code)
      .single();

    if (error || !event) return withCors({ error: "Event not found" }, { status: 404 });
    return withCors({ event });
  }

  const idActionMatch = path.match(/^([0-9a-f-]{36})\/?(.*)$/);
  if (!idActionMatch) return withCors({ error: "Not found" }, { status: 404 });

  const eventId = idActionMatch[1];
  const action = idActionMatch[2];

  // GET /:id
  if (method === "GET" && !action) {
    const { data: event, error } = await supabase.from("events").select("*").eq("id", eventId).single();
    if (error || !event) return withCors({ error: "Event not found" }, { status: 404 });
    return withCors({ event });
  }

  // POST /:id/join
  if (method === "POST" && action === "join") {
    const { data: event } = await supabase.from("events").select("id, status, max_participants, participant_count").eq("id", eventId).single();
    if (!event) return withCors({ error: "Event not found" }, { status: 404 });
    if (event.status === "ended") return withCors({ error: "Event has ended" }, { status: 400 });
    if (event.max_participants && event.participant_count >= event.max_participants) {
      return withCors({ error: "Event is full" }, { status: 400 });
    }

    const { error } = await supabase.from("event_participants").insert({
      event_id: eventId,
      user_id: user.id,
      role: "guest",
    });

    if (error) {
      if (String(error).includes("duplicate")) return withCors({ ok: true, already_joined: true });
      return withCors({ error: "Failed to join", detail: String(error) }, { status: 500 });
    }
    return withCors({ ok: true });
  }

  // Fetch event for host-only actions
  const { data: hostEvent } = await supabase
    .from("events")
    .select("id, host_id, status, participant_count")
    .eq("id", eventId)
    .single();
  if (!hostEvent) return withCors({ error: "Event not found" }, { status: 404 });
  if (hostEvent.host_id !== user.id) return withCors({ error: "Only the host can perform this action" }, { status: 403 });

  const applyMaxParticipantsPatch = (raw: unknown): number | null => {
    if (raw === null || raw === "") return null;
    if (typeof raw === "number" && Number.isFinite(raw) && raw > 0) return Math.floor(raw);
    return null;
  };

  // PUT /:id — update event (full edit for draft/scheduled; live: max_participants + is_private only)
  if (method === "PUT" && !action) {
    if (hostEvent.status === "ended") {
      return withCors({ error: "Cannot update an ended event" }, { status: 400 });
    }

    const body = (await req.json()) as Record<string, unknown>;
    const patch: Record<string, unknown> = {};

    if (hostEvent.status === "live") {
      if (body.max_participants !== undefined) {
        patch.max_participants = applyMaxParticipantsPatch(body.max_participants);
      }
      if (body.is_private !== undefined) {
        patch.is_private = Boolean(body.is_private);
      } else if (typeof body.is_public === "boolean") {
        patch.is_private = !body.is_public;
      }
      if (patch.max_participants != null && typeof patch.max_participants === "number") {
        const pc = Number(hostEvent.participant_count) || 0;
        if (patch.max_participants < pc) {
          return withCors(
            { error: `Max guests must be at least ${pc} (current guests), or leave unlimited` },
            { status: 400 },
          );
        }
      }
    } else {
      const allowed = ["title", "type", "description", "location", "event_date", "event_time", "is_private", "max_participants"];
      for (const key of allowed) {
        if (body[key] === undefined) continue;
        if (key === "max_participants") {
          patch[key] = applyMaxParticipantsPatch(body[key]);
          continue;
        }
        patch[key] = body[key];
      }
      if (typeof body.is_public === "boolean" && body.is_private === undefined) {
        patch.is_private = !body.is_public;
      }
      const scheduledStart = body.scheduled_start as string | undefined;
      if (scheduledStart) {
        const d = new Date(scheduledStart);
        if (!Number.isNaN(d.getTime())) {
          patch.scheduled_at = d.toISOString();
          const [datePart, timePart] = scheduledStart.split("T");
          if (datePart) patch.event_date = datePart;
          if (timePart) patch.event_time = timePart.split(".")[0].slice(0, 8);
        }
      }
    }

    if (Object.keys(patch).length === 0) {
      const { data: current } = await supabase.from("events").select("*").eq("id", eventId).single();
      return withCors({ ok: true, event: current });
    }

    const { data: updated, error } = await supabase.from("events").update(patch).eq("id", eventId).select().single();
    if (error) return withCors({ error: "Update failed", detail: String(error) }, { status: 500 });
    return withCors({ ok: true, event: updated });
  }

  // POST /:id/go-live
  if (method === "POST" && action === "go-live") {
    if (hostEvent.status === "live") return withCors({ ok: true, already_live: true });
    if (hostEvent.status === "ended") return withCors({ error: "Cannot reopen an ended event" }, { status: 400 });

    const { error } = await supabase.from("events").update({
      status: "live",
      started_at: new Date().toISOString(),
    }).eq("id", eventId);

    if (error) return withCors({ error: "Failed to go live" }, { status: 500 });
    return withCors({ ok: true });
  }

  // POST /:id/end
  if (method === "POST" && action === "end") {
    if (hostEvent.status === "ended") return withCors({ ok: true, already_ended: true });

    const { error } = await supabase.from("events").update({
      status: "ended",
      ended_at: new Date().toISOString(),
    }).eq("id", eventId);

    if (error) return withCors({ error: "Failed to end event" }, { status: 500 });
    return withCors({ ok: true });
  }

  // DELETE /:id
  if (method === "DELETE" && !action) {
    if (hostEvent.status !== "draft") {
      return withCors({ error: "Can only delete draft events" }, { status: 400 });
    }
    const { error } = await supabase.from("events").delete().eq("id", eventId);
    if (error) return withCors({ error: "Delete failed" }, { status: 500 });
    return withCors({ ok: true });
  }

  return withCors({ error: "Not found" }, { status: 404 });
});
