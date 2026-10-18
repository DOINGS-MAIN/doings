import { withCors } from "../_shared/cors.ts";
import { floorHoldMoney } from "../_shared/floorMoney.ts";
import type { AdminRouteCtx } from "./payouts.ts";

const EVENT_COLUMNS =
  "id, host_id, title, event_code, type, status, is_private, participant_count, total_sprayed, flagged, flag_reason, " +
  "started_at, ended_at, scheduled_at";
const HOLD_COLUMNS =
  "id, event_id, sprayer_id, planned_amount_kobo, denomination, note_count, status, floor_slot, floor_seconds, " +
  "floor_started_at, floor_ends_at, queued_at, created_at, expires_at, transfer_id, charged_amount_kobo";
const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

// The floor functions' own refusals (shown to the admin as 409); anything else is a real failure (500).
const REFUSALS = [
  "Spray hold not found", "This spray isn't on the floor or in the queue", "A reason is required",
  "Keep the reason under 500 characters", "The event has ended; its floor settles automatically", "Event not found",
];
const rpcFailure = (message: string) =>
  withCors({ error: message }, { status: REFUSALS.some((r) => message.startsWith(r)) ? 409 : 500 });

// One live event from the inside: who's on the dance floor, who's queued, other active sprays, and
// floor control (advance a stuck floor; remove one spray using the floor's own settle rules).
export async function handleLiveEvent(ctx: AdminRouteCtx & { holdId?: string }): Promise<Response | null> {
  const { req, supabase, authId, action, id, holdId } = ctx;
  if (!id || !UUID.test(id)) return withCors({ error: "Event not found" }, { status: 404 });

  if (req.method === "GET" && !action) {
    const { data: event, error } = await supabase.from("events").select(EVENT_COLUMNS).eq("id", id).maybeSingle();
    if (error) throw error;
    if (!event) return withCors({ error: "Event not found" }, { status: 404 });

    const [hostRes, holdsRes] = await Promise.all([
      supabase.from("users").select("id, full_name, email").eq("id", event.host_id).maybeSingle(),
      supabase.from("spray_holds").select(HOLD_COLUMNS).eq("event_id", id).in("status", ["pending", "queued", "on_floor"]),
    ]);
    if (hostRes.error) throw hostRes.error;
    if (holdsRes.error) throw holdsRes.error;

    // Names only: the page has no use for sprayers' phone numbers or emails.
    const named = (await ctx.attachUserFields(
      ((holdsRes.data ?? []) as Record<string, unknown>[]).map((h) => ({ ...h, user_id: h.sprayer_id })),
    )).map(({ user_phone: _p, user_email: _e, user_id: _u, ...h }) => h);
    const time = (v: unknown) => (v ? new Date(v as string).getTime() : 0);
    const now = Date.now();
    const floor = named.filter((h) => h.status === "on_floor")
      .sort((a, b) => Number(a.floor_slot ?? 0) - Number(b.floor_slot ?? 0))
      .map((h) => {
        const m = floorHoldMoney(h as Parameters<typeof floorHoldMoney>[0], now);
        return { ...h, paid: m.paid, charged_so_far_kobo: m.charged_so_far_kobo };
      });
    const queue = named.filter((h) => h.status === "queued").sort((a, b) => time(a.queued_at) - time(b.queued_at));
    const holds = named.filter((h) => h.status === "pending").sort((a, b) => time(a.created_at) - time(b.created_at));

    return withCors({
      event,
      host: hostRes.data ?? null,
      totals: {
        holds_active: named.length,
        // Sprays paid on stepping onto the floor (101) aren't held any more; they're already in total_sprayed.
        held_kobo: named.reduce((s, h) => s + floorHoldMoney(h as Parameters<typeof floorHoldMoney>[0], now).held_kobo, 0),
        sprayed_kobo: Number(event.total_sprayed ?? 0),
      },
      floor,
      queue,
      holds,
    });
  }

  if (req.method === "POST" && action === "advance-floor") {
    const { data, error } = await supabase.rpc("admin_advance_floor", { p_event_id: id, p_admin_auth_id: authId });
    if (error) return rpcFailure(error.message);
    return withCors({ ok: true, ...(data as Record<string, unknown>) });
  }

  if (req.method === "POST" && action === "remove-hold") {
    if (!holdId || !UUID.test(holdId)) return withCors({ error: "Spray hold not found in this event" }, { status: 404 });
    const body = await req.json().catch(() => ({})) as { reason?: unknown };
    if (typeof body.reason !== "string") return withCors({ error: "reason is required" }, { status: 400 });

    // A hold from another event must never be acted on through this event's page.
    const { data: hold, error } = await supabase.from("spray_holds").select("id, event_id").eq("id", holdId).maybeSingle();
    if (error) throw error;
    if (!hold || hold.event_id !== id) return withCors({ error: "Spray hold not found in this event" }, { status: 404 });

    const { data, error: rpcErr } = await supabase.rpc("admin_remove_floor_hold", {
      p_event_id: id, p_hold_id: holdId, p_admin_auth_id: authId, p_reason: body.reason,
    });
    if (rpcErr) return rpcFailure(rpcErr.message);
    const out = data as { was_status?: string; charged_kobo?: number; already_paid?: boolean };
    return withCors({
      ok: true, was_status: out?.was_status, charged_kobo: Number(out?.charged_kobo ?? 0), already_paid: out?.already_paid === true,
    });
  }

  return null;
}
