import { withCors } from "../_shared/cors.ts";
import { orIlike, parsePaging } from "../_shared/adminSearch.ts";
import { giveawayCodeMatches } from "../_shared/adminAccess.ts";
import type { AdminRouteCtx } from "./payouts.ts";

const COLUMNS =
  "id, creator_id, title, total_amount, per_person_amount, remaining_amount, max_recipients, code, status, type, event_id, " +
  "is_private, show_on_event_screen, funding_transaction_id, refund_transaction_id, stopped_at, stopped_by, stop_reason, created_at";
const STATUSES = new Set(["active", "stopped", "exhausted"]);
const TYPES = new Set(["live", "scheduled"]);
const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

export async function handleGiveaways(ctx: AdminRouteCtx): Promise<Response | null> {
  const { req, supabase, authId, action, id } = ctx;
  const url = new URL(req.url);

  if (req.method === "GET" && !id) {
    const { page, limit, from, to } = parsePaging(url.searchParams);
    let q = supabase.from("giveaways").select(COLUMNS, { count: "exact" });
    const status = url.searchParams.get("status");
    if (status && STATUSES.has(status)) q = q.eq("status", status);
    const type = url.searchParams.get("type");
    if (type && TYPES.has(type)) q = q.eq("type", type);
    const creator = url.searchParams.get("creator_id");
    if (creator && UUID.test(creator)) q = q.eq("creator_id", creator);
    const search = orIlike(["code", "title"], url.searchParams.get("search"));
    if (search) q = q.or(search);
    const { data, count, error } = await q
      .order("created_at", { ascending: false })
      .order("id", { ascending: false })
      .range(from, to);
    if (error) throw error;
    const rows = (data ?? []) as Record<string, unknown>[];
    // creator names (attachUserFields keys on user_id)
    const named = await ctx.attachUserFields(rows.map((g) => ({ ...g, user_id: g.creator_id })));
    return withCors({ giveaways: named, total: count, page, limit });
  }

  if (req.method === "GET" && id) {
    const { data: g, error } = await supabase.from("giveaways").select(COLUMNS).eq("id", id).maybeSingle();
    if (error) throw error;
    if (!g) return withCors({ error: "Giveaway not found" }, { status: 404 });
    const must = <T>(r: { data: T | null; error: unknown }) => {
      if (r.error) throw r.error;
      return r.data;
    };
    const [creator, event, redemptions, funding, refund] = await Promise.all([
      supabase.from("users").select("id, full_name, email, username").eq("id", g.creator_id).maybeSingle(),
      g.event_id
        ? supabase.from("events").select("id, title, event_code, status").eq("id", g.event_id).maybeSingle()
        : Promise.resolve({ data: null, error: null }),
      supabase.from("giveaway_redemptions").select("id, user_id, amount, transaction_id, redeemed_at")
        .eq("giveaway_id", id).order("redeemed_at", { ascending: false }).limit(500),
      g.funding_transaction_id
        ? supabase.from("transactions").select("id, amount, status, created_at").eq("id", g.funding_transaction_id).maybeSingle()
        : Promise.resolve({ data: null, error: null }),
      g.refund_transaction_id
        ? supabase.from("transactions").select("id, amount, status, created_at").eq("id", g.refund_transaction_id).maybeSingle()
        : Promise.resolve({ data: null, error: null }),
    ]);
    let stoppedByEmail: string | null = null;
    if (g.stopped_by) {
      const { data: u } = await supabase.auth.admin.getUserById(g.stopped_by as string);
      stoppedByEmail = u?.user?.email ?? null;
    }
    return withCors({
      giveaway: g,
      creator: must(creator),
      event: must(event),
      redemptions: await ctx.attachUserFields((must(redemptions) ?? []) as Record<string, unknown>[]),
      funding_transaction: must(funding),
      refund_transaction: must(refund),
      stopped_by_email: stoppedByEmail,
    });
  }

  if (req.method === "POST" && id && action === "stop") {
    const body = await req.json().catch(() => ({})) as { reason?: string; confirm?: string };
    const { data: g, error } = await supabase.from("giveaways").select("id, code").eq("id", id).maybeSingle();
    if (error) throw error;
    if (!g) return withCors({ error: "Giveaway not found" }, { status: 404 });
    if (!giveawayCodeMatches(body.confirm, g.code as string)) {
      return withCors({ error: "Type the giveaway code to confirm" }, { status: 400 });
    }
    const { data, error: rpcErr } = await supabase.rpc("admin_stop_giveaway", {
      p_giveaway_id: id, p_admin_auth_id: authId, p_reason: body.reason ?? "",
    });
    if (rpcErr) return withCors({ error: rpcErr.message }, { status: 409 });
    return withCors({ ok: true, refunded: Number((data as { refunded?: number })?.refunded ?? 0) });
  }

  return null;
}
