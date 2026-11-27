import { withCors } from "../_shared/cors.ts";
import { cleanSearch, orIlike, parsePaging, quoteValue } from "../_shared/adminSearch.ts";
import { giveawayCodeMatches, maskGiveawayCode } from "../_shared/adminAccess.ts";
import type { AdminRouteCtx } from "./payouts.ts";

const COLUMNS =
  "id, creator_id, title, total_amount, per_person_amount, remaining_amount, max_recipients, code, status, type, event_id, " +
  "is_private, show_on_event_screen, funding_transaction_id, refund_transaction_id, stopped_at, stop_reason, created_at";
const STATUSES = new Set(["active", "stopped", "exhausted"]);
const TYPES = new Set(["live", "scheduled"]);
const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

export async function handleGiveaways(ctx: AdminRouteCtx): Promise<Response | null> {
  const { req, supabase, authId, audit, action, id } = ctx;
  const url = new URL(req.url);

  if (id && !UUID.test(id)) return withCors({ error: "Giveaway not found" }, { status: 404 });

  if (req.method === "GET" && !id) {
    const { page, limit, from, to } = parsePaging(url.searchParams);
    // The real claim count and the event come embedded (a stop zeroes the remainder).
    let q = supabase.from("giveaways")
      .select(`${COLUMNS}, giveaway_redemptions(count), events(title, event_code)`, { count: "exact" });
    const status = url.searchParams.get("status");
    if (status && STATUSES.has(status)) q = q.eq("status", status);
    const type = url.searchParams.get("type");
    if (type && TYPES.has(type)) q = q.eq("type", type);
    const creator = url.searchParams.get("creator_id");
    if (creator && !UUID.test(creator)) return withCors({ error: "creator_id must be a user id" }, { status: 400 });
    if (creator) q = q.eq("creator_id", creator);
    // Codes match only in full: partial matching would let a view-only role rebuild a masked code
    // letter by letter. Titles match partially as usual.
    const text = cleanSearch(url.searchParams.get("search"));
    if (text) {
      const exactCode = quoteValue(text.replace(/\s+/g, "").toUpperCase());
      q = q.or(`${orIlike(["title"], text)},code.eq.${exactCode}`);
    }
    const { data, count, error } = await q
      .order("created_at", { ascending: false })
      .order("id", { ascending: false })
      .range(from, to);
    if (error) throw error;
    const rows = (data ?? []) as Record<string, unknown>[];
    // What went back to the creator (a stop zeroes the remainder): the refund transaction's amount.
    const refundIds = rows.map((g) => g.refund_transaction_id as string | null).filter(Boolean) as string[];
    const returned = new Map<string, number>();
    if (refundIds.length > 0) {
      const { data: refunds, error: refundErr } = await supabase.from("transactions").select("id, amount").in("id", refundIds);
      if (refundErr) throw refundErr;
      for (const t of refunds ?? []) returned.set(t.id as string, Math.abs(Number(t.amount ?? 0)));
    }
    // creator names (attachUserFields keys on user_id)
    const named = await ctx.attachUserFields(rows.map((g) => ({
      ...g,
      user_id: g.creator_id,
      returned_amount: g.refund_transaction_id ? returned.get(g.refund_transaction_id as string) ?? null : null,
    })));
    // Never send an active giveaway's code: it's effectively cash.
    const giveaways = named.map((g) => ({
      ...g,
      code: maskGiveawayCode(g.code as string, g.status as string),
      code_masked: g.status === "active",
    }));
    return withCors({ giveaways, total: count, page, limit });
  }

  if (req.method === "GET" && id) {
    const { data: g, error } = await supabase.from("giveaways").select(COLUMNS).eq("id", id).maybeSingle();
    if (error) throw error;
    if (!g) return withCors({ error: "Giveaway not found" }, { status: 404 });
    const must = <T>(r: { data: T | null; error: unknown }) => {
      if (r.error) throw r.error;
      return r.data;
    };
    const [creator, event, redemptions, redemptionCount, funding, refund] = await Promise.all([
      supabase.from("users").select("id, full_name, email, username").eq("id", g.creator_id).maybeSingle(),
      g.event_id
        ? supabase.from("events").select("id, title, event_code, status").eq("id", g.event_id).maybeSingle()
        : Promise.resolve({ data: null, error: null }),
      supabase.from("giveaway_redemptions").select("id, user_id, amount, transaction_id, redeemed_at")
        .eq("giveaway_id", id).order("redeemed_at", { ascending: false }).limit(500),
      supabase.from("giveaway_redemptions").select("id", { count: "exact", head: true }).eq("giveaway_id", id),
      g.funding_transaction_id
        ? supabase.from("transactions").select("id, amount, status, created_at").eq("id", g.funding_transaction_id).maybeSingle()
        : Promise.resolve({ data: null, error: null }),
      g.refund_transaction_id
        ? supabase.from("transactions").select("id, amount, status, created_at").eq("id", g.refund_transaction_id).maybeSingle()
        : Promise.resolve({ data: null, error: null }),
    ]);
    let stoppedByEmail: string | null = null;
    // Who stopped it is kept only in the audit log (creators can read the giveaway row).
    if (g.status === "stopped") {
      const { data: audit } = await supabase.from("admin_audit_log").select("admin_user_id")
        .eq("action", "stop_giveaway").eq("target_id", id).order("created_at", { ascending: false }).limit(1).maybeSingle();
      if (audit?.admin_user_id) {
        const { data: u } = await supabase.auth.admin.getUserById(audit.admin_user_id as string);
        stoppedByEmail = u?.user?.email ?? null;
      }
    }
    return withCors({
      giveaway: { ...g, code: maskGiveawayCode(g.code as string, g.status as string), code_masked: g.status === "active" },
      creator: must(creator),
      event: must(event),
      redemptions: await ctx.attachUserFields((must(redemptions) ?? []) as Record<string, unknown>[]),
      redemption_count: (() => {
        if (redemptionCount.error) throw redemptionCount.error;
        return redemptionCount.count ?? 0;
      })(),
      funding_transaction: must(funding),
      refund_transaction: must(refund),
      stopped_by_email: stoppedByEmail,
    });
  }

  if (req.method === "POST" && id && action === "stop") {
    const body = await req.json().catch(() => ({})) as { reason?: unknown; confirm?: unknown };
    if (typeof body.reason !== "string" || typeof body.confirm !== "string") {
      return withCors({ error: "reason and confirm are required" }, { status: 400 });
    }
    const { data: g, error } = await supabase.from("giveaways").select("id, code").eq("id", id).maybeSingle();
    if (error) throw error;
    if (!g) return withCors({ error: "Giveaway not found" }, { status: 404 });
    if (!giveawayCodeMatches(body.confirm, g.code as string)) {
      return withCors({ error: "Type the giveaway code to confirm" }, { status: 400 });
    }
    const { data, error: rpcErr } = await supabase.rpc("admin_stop_giveaway", {
      p_giveaway_id: id, p_admin_auth_id: authId, p_reason: body.reason,
    });
    if (rpcErr) return withCors({ error: rpcErr.message }, { status: 409 });
    return withCors({ ok: true, refunded: Number((data as { refunded?: number })?.refunded ?? 0) });
  }

  // ── POST giveaways/:id/reveal-code ── stop roles only (the role gate checks giveaways.stop); audited.
  if (req.method === "POST" && id && action === "reveal-code") {
    const { data: g, error } = await supabase.from("giveaways").select("id, code, status").eq("id", id).maybeSingle();
    if (error) throw error;
    if (!g) return withCors({ error: "Giveaway not found" }, { status: 404 });
    await audit({ action: "reveal_giveaway_code", targetType: "giveaway", targetId: id, details: { status: g.status } });
    return withCors({ code: g.code });
  }

  return null;
}
