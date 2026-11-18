import { withCors } from "../_shared/cors.ts";
import { maskAccountNumber, nameConfirmMatches, user360Sections } from "../_shared/adminAccess.ts";
import type { AdminRouteCtx } from "./payouts.ts";

const USER_COLUMNS = "id, full_name, username, email, phone, avatar_url, status, suspended_reason, suspended_at, kyc_level, created_at, last_active_at";
const KYC_COLUMNS =
  "id, level, status, provider, verification_method, bvn_last_four, nin_last_four, selfie_match_confidence, liveness_score, " +
  "rejection_reason, submitted_at, verified_at, reviewed_at, superseded_at";
const KYC_ATTEMPTS_MAX = 5;
const VIEW_RECORD_EVERY_MS = 10 * 60_000;

type Ctx = Omit<AdminRouteCtx, "attachUserFields"> & { role: string; resource: "users" | "kyc" };

export async function handleUser360(ctx: Ctx): Promise<Response | null> {
  const { req, supabase, authId, audit, ip, action, id, role, resource } = ctx;
  if (!id) return null;

  // ── GET users/:id: only the sections this role may see are queried and returned ──
  if (resource === "users" && req.method === "GET" && !action) {
    const can = user360Sections(role);
    // PIN state rides on the same row; only read it when the role may see the security section.
    const pinColumns = can.security ? ", transaction_pin_set_at, transaction_pin_failed_attempts, transaction_pin_locked_until" : "";
    const { data: row, error } = await supabase.from("users").select(USER_COLUMNS + pinColumns).eq("id", id).maybeSingle();
    if (error) throw error;
    if (!row) return withCors({ error: "User not found" }, { status: 404 });
    const {
      transaction_pin_set_at: pinSetAt,
      transaction_pin_failed_attempts: pinFailed,
      transaction_pin_locked_until: pinLockedUntil,
      ...user
    } = row as Record<string, unknown>;
    const userId = user.id as string; // canonical id from the database, not the URL text

    const since = new Date(Date.now() - 86_400_000).toISOString();
    const must = <T>(r: { data: T | null; error: unknown }) => {
      if (r.error) throw r.error;
      return r.data;
    };
    const sections: Record<string, unknown> = {};
    if (can.security) {
      sections.security = {
        pin_set: !!pinSetAt,
        pin_failed_attempts: Number(pinFailed ?? 0),
        pin_locked_until: pinLockedUntil ?? null,
      };
    }

    // Every section the role may see is fetched in one parallel batch; the rest are never queried.
    const tasks: Promise<void>[] = [];

    if (can.kyc) {
      tasks.push((async () => {
        const [records, attempts] = await Promise.all([
          supabase.from("kyc_verifications").select(KYC_COLUMNS).eq("user_id", userId).order("submitted_at", { ascending: false }),
          supabase.from("rate_limit_hits").select("key", { count: "exact", head: true }).eq("key", `kyc-l2:${userId}`).gte("hit_at", since),
        ]);
        if (attempts.error) throw attempts.error;
        sections.kyc = { records: must(records) ?? [], attempts_24h: attempts.count ?? 0, attempts_max: KYC_ATTEMPTS_MAX };
      })());
    }

    if (can.money) {
      tasks.push((async () => {
        const [wallets, txns, payouts, orders, banks] = await Promise.all([
          supabase.from("wallets").select("currency, balance, locked_balance").eq("user_id", userId),
          supabase.from("transactions").select("id, type, currency, amount, status, idempotency_key, created_at")
            .eq("user_id", userId).order("created_at", { ascending: false }).order("id", { ascending: false }).limit(20),
          supabase.from("transactions").select("id, currency, amount, status, idempotency_key, metadata, created_at")
            .eq("user_id", userId).eq("type", "withdrawal").in("status", ["pending", "processing"]).order("created_at", { ascending: false }),
          supabase.from("bundle_orders").select("id, currency, bundles, amount, status, tx_ref, refunded_at, created_at")
            .eq("user_id", userId).order("created_at", { ascending: false }).limit(10),
          supabase.from("bank_accounts").select("id, bank_name, account_name, account_number, is_default, created_at")
            .eq("user_id", userId).order("created_at", { ascending: false }),
        ]);
        sections.money = {
          wallets: must(wallets) ?? [],
          transactions: must(txns) ?? [],
          open_payouts: ((must(payouts) ?? []) as Record<string, unknown>[]).map(({ metadata, ...p }) => ({
            ...p,
            needs_review: (metadata as Record<string, unknown> | null)?.needs_review === true,
          })),
          bundle_orders: must(orders) ?? [],
          // Never send full account numbers to the browser.
          bank_accounts: ((must(banks) ?? []) as Record<string, unknown>[]).map(({ account_number, ...b }) => ({
            ...b,
            account_number: maskAccountNumber(account_number as string),
          })),
        };
      })());
    }

    if (can.activity) {
      tasks.push((async () => {
        const [events, giveaways] = await Promise.all([
          supabase.from("events").select("id, title, status, event_code, created_at").eq("host_id", userId)
            .order("created_at", { ascending: false }).limit(10),
          supabase.from("giveaways").select("id", { count: "exact", head: true }).eq("creator_id", userId),
        ]);
        if (giveaways.error) throw giveaways.error;
        sections.activity = { events_hosted: must(events) ?? [], giveaways_created: giveaways.count ?? 0 };
      })());
    }

    await Promise.all(tasks);
    // Opening a person's page shows their contact, KYC and money details, so it is on the record.
    // The page refetches while it is open, so one record per admin and person every ten minutes is enough.
    const { count: recentViews, error: viewsErr } = await supabase
      .from("admin_audit_log").select("id", { count: "exact", head: true })
      .eq("action", "view_user").eq("admin_user_id", authId).eq("target_id", userId)
      .gte("created_at", new Date(Date.now() - VIEW_RECORD_EVERY_MS).toISOString());
    if (viewsErr) throw viewsErr;
    if (!recentViews) {
      await audit({ action: "view_user", targetType: "user", targetId: userId, details: { sections: Object.keys(sections) } });
    }
    return withCors({ user, sections, can });
  }

  // ── POST kyc/:id/revoke ──
  if (resource === "kyc" && req.method === "POST" && action === "revoke") {
    const body = await req.json().catch(() => ({})) as { reason?: string; confirm?: string };
    const { data: rec, error } = await supabase.from("kyc_verifications").select("id, user_id").eq("id", id).maybeSingle();
    if (error) throw error;
    if (!rec) return withCors({ error: "KYC record not found" }, { status: 404 });
    const { data: person, error: personErr } = await supabase.from("users").select("full_name, email").eq("id", rec.user_id).maybeSingle();
    if (personErr) throw personErr;
    if (!person || !nameConfirmMatches(body.confirm, person)) {
      return withCors({ error: "Type the person's name to confirm" }, { status: 400 });
    }
    const { data, error: rpcErr } = await supabase.rpc("admin_revoke_kyc", {
      p_kyc_id: id, p_admin_auth_id: authId, p_reason: body.reason ?? "",
    });
    if (rpcErr) return withCors({ error: rpcErr.message }, { status: 409 });
    return withCors({ ok: true, kyc_level: (data as { kyc_level?: number })?.kyc_level });
  }

  // ── POST users/:id/kyc-reset ──
  if (resource === "users" && req.method === "POST" && action === "kyc-reset") {
    const { data, error } = await supabase.rpc("admin_reset_kyc_attempts", { p_user_id: id, p_admin_auth_id: authId });
    if (error) return withCors({ error: error.message }, { status: 409 });
    return withCors({ ok: true, removed: (data as { removed?: number })?.removed ?? 0 });
  }

  // ── POST users/:id/clear-pin-lock ── the change, its audit record and the notice are one database step.
  if (resource === "users" && req.method === "POST" && action === "clear-pin-lock") {
    const { error } = await supabase.rpc("admin_clear_pin_lock", { p_user_id: id, p_admin_auth_id: authId, p_ip: ip });
    if (error) return withCors({ error: error.message }, { status: 409 });
    return withCors({ ok: true });
  }

  return null;
}
