/**
 * Rate-limited live spray feed for anonymous public projector viewers.
 * Only public + live events; never exposes private event data.
 */
import { corsHeaders, withCors } from "../_shared/cors.ts";
import { getServiceClient } from "../_shared/db.ts";
import { checkRateLimit, RATE_LIMITS } from "../_shared/rate-limit.ts";

function clientIp(req: Request): string {
  const forwarded = req.headers.get("x-forwarded-for");
  if (forwarded) return forwarded.split(",")[0]?.trim() || "unknown";
  return req.headers.get("cf-connecting-ip") ?? req.headers.get("x-real-ip") ?? "unknown";
}

Deno.serve(async (req) => {
  if (req.method === "OPTIONS") return new Response("ok", { headers: corsHeaders });
  if (req.method !== "GET") {
    return withCors({ error: "Method not allowed" }, { status: 405 });
  }

  const url = new URL(req.url);
  const eventId = url.searchParams.get("event_id")?.trim() ?? "";
  const eventCode = url.searchParams.get("code")?.trim().toUpperCase() ?? "";

  if (!eventId && !eventCode) {
    return withCors({ error: "event_id or code is required" }, { status: 400 });
  }

  const supabase = getServiceClient();

  let query = supabase
    .from("events")
    .select("id, status, is_private")
    .limit(1);

  query = eventId ? query.eq("id", eventId) : query.eq("event_code", eventCode);

  const { data: event, error: eventErr } = await query.maybeSingle();
  if (eventErr) {
    return withCors({ error: "Could not load event" }, { status: 500 });
  }
  if (!event || event.is_private || event.status !== "live") {
    return withCors({ error: "Event not available" }, { status: 404 });
  }

  const ip = clientIp(req);
  const limit = RATE_LIMITS.publicProjector(`${ip}:${event.id}`);
  const rate = await checkRateLimit(limit);
  if (!rate.allowed) {
    return withCors(
      {
        error: "Rate limit exceeded",
        retry_after_ms: rate.retryAfterMs ?? 60_000,
      },
      { status: 429 },
    );
  }

  const { data: liveSprays, error: holdsErr } = await supabase.rpc("get_event_live_spray_holds", {
    p_event_id: event.id,
  });

  if (holdsErr) {
    return withCors({ error: "Could not load live sprays" }, { status: 500 });
  }

  return withCors({
    event_id: event.id,
    live_sprays: liveSprays ?? [],
    remaining: rate.remaining,
  });
});
