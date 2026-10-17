import { withCors } from "../_shared/cors.ts";
import { maskAccountNumber, nameConfirmMatches, user360Sections } from "../_shared/adminAccess.ts";
import type { AdminRouteCtx } from "./payouts.ts";

const USER_COLUMNS = "id, full_name, username, email, phone, avatar_url, status, suspended_reason, suspended_at, kyc_level, created_at, last_active_at";
const KYC_COLUMNS =
  "id, level, status, provider, verification_method, bvn_last_four, nin_last_four, selfie_match_confidence, liveness_score, " +
  "rejection_reason, submitted_at, verified_at, reviewed_at, superseded_at";
const KYC_ATTEMPTS_MAX = 5;

type Ctx = AdminRouteCtx & { role: string; resource: "users" | "kyc" };

export async function handleUser360(ctx: Ctx): Promise<Response | null> {
  const { req, supabase, authId, action, id, role, resource } = ctx;
  if (!id) return null;

  // ── GET users/:id: only the sections this role may see are queried and returned ──
  if (resource === "users" && req.method === "GET" && !action) {
    const can = user360Sections(role);
    const { data: user, error } = await supabase.from("users").select(USER_COLUMNS).eq("id", id).maybeSingle();
    if (error) throw error;
    if (!user) return withCors({ error: "User not found" }, { status: 404 });

    const since = new Date(Date.now() - 86_400_000).toISOString();
    const must = <T>(r: { data: T | null; error: unknown }) => {
      if (r.error) throw r.error;
      return r.data;
    };
    const sections: Record<string, unknown> = {};

    if (can.security) {
      const pin = must(await supabase.from("users")
        .select("transaction_pin_set_at, transaction_pin_failed_attempts, transaction_pin_locked_until").eq("id", id).maybeSingle()) as
        Record<string, unknown> | null;
      sections.security = {
        pin_set: !!pin?.transaction_pin_set_at,
        pin_failed_attempts: Number(pin?.transaction_pin_failed_attempts ?? 0),
        pin_locked_until: pin?.transaction_pin_locked_until ?? null,
      };
    }

    if (can.kyc) {
      const [records, attempts] = await Promise.all([
        supabase.from("kyc_verifications").select(KYC_COLUMNS).eq("user_id", id).order("submitted_at", { ascending: false }),
        supabase.from("rate_limit_hits").select("key", { count: "exact", head: true }).eq("key", `kyc-l2:${id}`).gte("hit_at", since),
      ]);
      if (attempts.error) throw attempts.error;
      sections.kyc = { records: must(records) ?? [], attempts_24h: attempts.count ?? 0, attempts_max: KYC_ATTEMPTS_MAX };
    }

    if (can.money) {
      const [wallets, txns, payouts, orders, banks] = await Promise.all([
        supabase.from("wallets").select("currency, balance, locked_balance").eq("user_id", id),
        supabase.from("transactions").select("id, type, currency, amount, status, idempotency_key, created_at")
          .eq("user_id", id).order("created_at", { ascending: false }).order("id", { ascending: false }).limit(20),
        supabase.from("transactions").select("id, currency, amount, status, idempotency_key, metadata, created_at")
          .eq("user_id", id).eq("type", "withdrawal").in("status", ["pending", "processing"]).order("created_at", { ascending: false }),
        supabase.from("bundle_orders").select("id, currency, bundles, amount, status, tx_ref, refunded_at, created_at")
          .eq("user_id", id).order("created_at", { ascending: false }).limit(10),
        supabase.from("bank_accounts").select("id, bank_name, account_name, account_number, is_default, created_at")
          .eq("user_id", id).order("created_at", { ascending: false }),
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
    }

    if (can.activity) {
      const [events, giveaways] = await Promise.all([
        supabase.from("events").select("id, title, status, event_code, created_at").eq("host_id", id)
          .order("created_at", { ascending: false }).limit(10),
        supabase.from("giveaways").select("id", { count: "exact", head: true }).eq("creator_id", id),
      ]);
      if (giveaways.error) throw giveaways.error;
      sections.activity = { events_hosted: must(events) ?? [], giveaways_created: giveaways.count ?? 0 };
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

  return null;
}
