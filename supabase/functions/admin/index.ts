import { corsHeaders, withCors } from "../_shared/cors.ts";
import { getAuthUserIdFromRequest, getServiceClient } from "../_shared/db.ts";
import type { SupabaseClient } from "https://esm.sh/@supabase/supabase-js@2.49.8";
import { getPlatformPaymentSettings } from "../_shared/psp/platformSettings.ts";
import { probeProviderHealth } from "../_shared/psp/registry.ts";
import { reprocessWebhookLog } from "../_shared/reprocessWebhook.ts";
import { cleanSearch, orIlike, parsePaging, quoteValue } from "../_shared/adminSearch.ts";
import { chunk, collectAll } from "../_shared/adminExport.ts";
import { handlePayouts } from "./payouts.ts";
import { handleBundleOrders } from "./bundleOrders.ts";
import { can, escapeLikePattern, isAdminRole, permissionFor, teamChangeAllowed } from "../_shared/adminAccess.ts";

const STUCK_AFTER_MINUTES = Number(Deno.env.get("WITHDRAWAL_RECONCILE_MINUTES") ?? "15");

const RESERVED_ACTIONS = new Set([
  "suspend", "unsuspend", "ban", "unban", "flag", "unflag", "approve", "reject", "end",
  "invite", "accept", "disable", "enable", "role", "refund", "reprocess", "export", "probe-all", "health",
  "check", "resolve",
]);

// The platform treasury's wallets belong to this user (see migration 083).
const TREASURY_USER_ID = "00000000-0000-4000-8000-000000000001";

// Bans last until an admin lifts them (100 years).
const AUTH_BAN_DURATION = "876000h";

// Explicit user detail columns: never PIN hashes or other secrets.
const USER_DETAIL_COLUMNS =
  "id, auth_id, phone, email, full_name, username, avatar_url, kyc_level, status, suspended_reason, suspended_at, suspended_by, " +
  "date_of_birth, address, referral_code, referred_by, last_active_at, transaction_pin_set_at, transaction_pin_locked_until, created_at, updated_at";

function csvEscape(value: unknown): string {
  const s = value == null ? "" : String(value);
  if (s.includes(",") || s.includes('"') || s.includes("\n")) {
    return `"${s.replace(/"/g, '""')}"`;
  }
  return s;
}

function toCsv(rows: Record<string, unknown>[], columns: string[]): string {
  const header = columns.join(",");
  const lines = rows.map((row) => columns.map((col) => csvEscape(row[col])).join(","));
  return [header, ...lines].join("\n");
}

// Walks a filtered query for a CSV export. The order has an id tiebreaker (rows written in one
// database transaction share created_at) and rows created after the export started are left out,
// so chunk boundaries can't duplicate or skip rows.
// deno-lint-ignore no-explicit-any
async function exportRows(build: () => any, startedAt: string): Promise<{ rows: Record<string, unknown>[]; truncated: boolean }> {
  return await collectAll(async (f, t) => {
    const { data, error } = await build()
      .lte("created_at", startedAt)
      .order("id", { ascending: false })
      .range(f, t);
    if (error) throw error;
    return (data ?? []) as Record<string, unknown>[];
  });
}

function csvResponse(filename: string, body: string, truncated = false): Response {
  return new Response(body, {
    headers: {
      ...corsHeaders,
      "Content-Type": "text/csv; charset=utf-8",
      "Content-Disposition": `attachment; filename="${filename}"`,
      "Access-Control-Expose-Headers": "X-Export-Truncated",
      ...(truncated ? { "X-Export-Truncated": "true" } : {}),
    },
  });
}

type UserSummary = { full_name?: string | null; phone?: string | null; email?: string | null };

async function loadUsersById(
  supabase: SupabaseClient,
  userIds: string[],
): Promise<Map<string, UserSummary>> {
  const unique = [...new Set(userIds.filter(Boolean))];
  if (unique.length === 0) return new Map();

  // Bounded groups keep each request URL short however many ids there are.
  const map = new Map<string, UserSummary>();
  for (const ids of chunk(unique)) {
    const { data, error } = await supabase
      .from("users")
      .select("id, full_name, phone, email")
      .in("id", ids);
    if (error) throw error;
    for (const row of data ?? []) map.set(row.id as string, row as UserSummary);
  }
  return map;
}

async function attachUserFields(
  supabase: SupabaseClient,
  rows: Record<string, unknown>[],
): Promise<Record<string, unknown>[]> {
  const usersById = await loadUsersById(
    supabase,
    rows.map((row) => row.user_id as string).filter(Boolean),
  );

  return rows.map((row) => {
    const user = usersById.get(row.user_id as string);
    return {
      ...row,
      user_name: user?.full_name ?? "",
      user_phone: user?.phone ?? "",
      user_email: user?.email ?? "",
    };
  });
}

type RouteAction =
  | { resource: "stats" }
  | { resource: "users"; action?: string; id?: string }
  | { resource: "transactions"; action?: string; id?: string }
  | { resource: "kyc"; action?: string; id?: string }
  | { resource: "events"; action?: string; id?: string }
  | { resource: "team"; action?: string; id?: string }
  | { resource: "audit" }
  | { resource: "payment-rails"; action?: string; id?: string }
  | { resource: "payments"; action?: string; id?: string }
  | { resource: "webhooks"; action?: string; id?: string }
  | { resource: "queue" }
  | { resource: "psp-events" }
  | { resource: "payouts"; action?: string; id?: string }
  | { resource: "bundle-orders"; action?: string; id?: string }
  | { resource: "unknown" };

function parseRoute(url: string): RouteAction {
  const u = new URL(url);
  const parts = u.pathname.split("/").filter(Boolean);
  const fnIdx = parts.indexOf("admin");
  const rest = parts.slice(fnIdx + 1);

  if (!rest.length || rest[0] === "stats") return { resource: "stats" };
  const resource = rest[0];
  const id = rest[1] && !RESERVED_ACTIONS.has(rest[1]) ? rest[1] : undefined;
  const action = id ? rest[2] : rest[1];

  if (rest[0] === "payment-rails") {
    if (rest[1] === "probe-all") return { resource: "payment-rails", action: "probe-all" };
    if (rest[1] === "health" && rest[2]) return { resource: "payment-rails", action: "health", id: rest[2] };
    return { resource: "payment-rails" };
  }

  if (rest[0] === "payments") {
    return { resource: "payments" };
  }

  if (rest[0] === "webhooks") {
    if (rest[2] === "reprocess") return { resource: "webhooks", action: "reprocess", id: rest[1] };
    if (rest[1] && !RESERVED_ACTIONS.has(rest[1])) return { resource: "webhooks", id: rest[1] };
    return { resource: "webhooks", action: rest[1] };
  }

  if (rest[0] === "queue") return { resource: "queue" };
  if (rest[0] === "psp-events") return { resource: "psp-events" };

  if (["users", "transactions", "kyc", "events", "team", "audit", "payouts", "bundle-orders"].includes(resource)) {
    return { resource: resource as RouteAction["resource"], action, id } as RouteAction;
  }
  return { resource: "unknown" };
}

async function requireAdmin(req: Request) {
  const authHeader = req.headers.get("Authorization");
  if (!authHeader) throw { status: 401, message: "Missing authorization" };

  const authUserId = await getAuthUserIdFromRequest(authHeader);
  if (!authUserId) throw { status: 401, message: "Unauthorized" };

  const supabase = getServiceClient();
  const { data: rows, error } = await supabase
    .from("admin_roles")
    .select("id, role, status")
    .eq("user_id", authUserId)
    .in("status", ["active", "invited"]);
  if (error) throw { status: 500, message: "Admin lookup failed" };

  const active = (rows ?? []).find((r) => r.status === "active");
  const invited = (rows ?? []).find((r) => r.status === "invited");
  if (!active && !invited) throw { status: 403, message: "Not an admin" };

  return {
    authId: authUserId,
    role: active ? active.role as string : "",
    activeRowId: active ? active.id as string : null,
    invitedRowId: active ? null : invited!.id as string,
    supabase,
  };
}

// The auth user id for an email: app users first, then a scan of auth users.
async function findAuthUserIdByEmail(supabase: SupabaseClient, email: string): Promise<string | null> {
  const { data: appUser } = await supabase
    .from("users")
    .select("auth_id")
    .ilike("email", escapeLikePattern(email))
    .not("auth_id", "is", null)
    .limit(1)
    .maybeSingle();
  if (appUser?.auth_id) {
    // The sign-in email is the authority; the profile email is only a shortcut to it.
    const { data: authUser } = await supabase.auth.admin.getUserById(appUser.auth_id as string);
    if ((authUser?.user?.email ?? "").toLowerCase() === email) return appUser.auth_id as string;
  }

  for (let page = 1; page <= 50; page++) {
    const { data, error } = await supabase.auth.admin.listUsers({ page, perPage: 1000 });
    if (error) throw error;
    const match = data.users.find((u) => (u.email ?? "").toLowerCase() === email);
    if (match) return match.id;
    if (data.users.length < 1000) break;
  }
  return null;
}

async function countActiveSuperAdmins(supabase: SupabaseClient): Promise<number> {
  const { count, error } = await supabase
    .from("admin_roles")
    .select("id", { count: "exact", head: true })
    .eq("role", "super_admin")
    .eq("status", "active");
  if (error) throw error;
  return count ?? 0;
}

Deno.serve(async (req) => {
  if (req.method === "OPTIONS") return new Response("ok", { headers: corsHeaders });

  let admin: Awaited<ReturnType<typeof requireAdmin>>;
  try {
    admin = await requireAdmin(req);
  } catch (err: unknown) {
    const e = err as { status?: number; message?: string };
    return withCors({ error: e.message ?? "Unauthorized" }, { status: e.status ?? 401 });
  }

  const { supabase, authId, role, activeRowId, invitedRowId } = admin;
  const route = parseRoute(req.url);
  const routeAction = "action" in route ? route.action : undefined;
  const routeId = "id" in route ? route.id : undefined;

  try {
    // ── ACCEPT INVITE ── called on every admin sign-in: activates a pending invite, else records the login.
    if (route.resource === "team" && req.method === "POST" && routeAction === "accept") {
      if (!invitedRowId) {
        await supabase.from("admin_roles").update({ last_login_at: new Date().toISOString() }).eq("id", activeRowId!);
        return withCors({ ok: true });
      }
      const { error } = await supabase
        .from("admin_roles")
        .update({ status: "active", must_change_password: false, last_login_at: new Date().toISOString() })
        .eq("id", invitedRowId)
        .eq("status", "invited");
      if (error) throw error;
      await supabase.rpc("log_admin_action", { p_admin_id: authId, p_action: "accept_admin_invite", p_target_type: "admin", p_target_id: invitedRowId });
      return withCors({ ok: true });
    }
    if (invitedRowId) return withCors({ error: "Accept your admin invite first" }, { status: 403 });

    const perm = permissionFor(route.resource, req.method, routeAction, !!routeId);
    if (!perm) return withCors({ error: "Not found" }, { status: 404 });
    if (!can(role, perm)) return withCors({ error: "Your admin role can't do this" }, { status: 403 });

    // ── PAYOUTS / BUNDLE ORDERS ── (route files; the role gate above already ran)
    if (route.resource === "payouts" || route.resource === "bundle-orders") {
      const ctx = {
        req, supabase, authId, action: routeAction, id: routeId,
        attachUserFields: (rows: Record<string, unknown>[]) => attachUserFields(supabase, rows),
      };
      const res = route.resource === "payouts" ? await handlePayouts(ctx) : await handleBundleOrders(ctx);
      return res ?? withCors({ error: "Not found" }, { status: 404 });
    }

    // ── STATS ──
    if (route.resource === "stats" && req.method === "GET") {
      const { data: stats, error } = await supabase.rpc("admin_dashboard_stats", { p_stuck_minutes: STUCK_AFTER_MINUTES });
      if (error) throw error;
      const n = (k: string) => Number((stats as Record<string, unknown> | null)?.[k] ?? 0);
      return withCors({
        totalUsers: n("total_users"),
        activeUsers: n("active_users"),
        suspendedUsers: n("blocked_users"),
        totalTransactions: n("total_transactions"),
        totalVolume: n("total_volume"),
        todayVolume: n("today_volume"),
        totalFeeRevenue: n("total_fee_revenue"),
        todayFeeRevenue: n("today_fee_revenue"),
        activeEvents: n("live_events"),
        totalEvents: n("total_events"),
        flaggedTransactions: n("flagged_transactions"),
        stuckWithdrawals: n("stuck_withdrawals"),
        ngnVolume: n("ngn_volume"),
        ngnTodayVolume: n("ngn_today_volume"),
        usdcVolume: n("usdc_volume"),
        usdcTodayVolume: n("usdc_today_volume"),
      });
    }

    // ── USERS ──
    if (route.resource === "users") {
      if (req.method === "GET" && !route.id) {
        const url = new URL(req.url);
        const { page, limit, from, to } = parsePaging(url.searchParams);
        const status = url.searchParams.get("status");
        const search = orIlike(["phone", "full_name", "email"], url.searchParams.get("search"));

        let query = supabase
          .from("users")
          .select("id, phone, email, full_name, kyc_level, status, suspended_reason, last_active_at, created_at", { count: "exact" })
          .order("created_at", { ascending: false })
          .order("id", { ascending: false })
          .range(from, to);

        if (status) query = query.eq("status", status);
        if (search) query = query.or(search);

        const { data, count, error } = await query;
        if (error) throw error;
        return withCors({ users: data, total: count, page, limit });
      }

      if (req.method === "GET" && route.id) {
        const { data, error } = await supabase
          .from("users")
          .select(`${USER_DETAIL_COLUMNS}, wallets(id, currency, balance, locked_balance)`)
          .eq("id", route.id)
          .single();
        if (error) throw error;
        return withCors(data);
      }

      if (req.method === "POST" && route.action === "suspend" && route.id) {
        const body = await req.json();
        const { error } = await supabase
          .from("users")
          .update({ status: "suspended", suspended_reason: body.reason ?? "", suspended_at: new Date().toISOString(), suspended_by: authId })
          .eq("id", route.id);
        if (error) throw error;
        await supabase.rpc("log_admin_action", { p_admin_id: authId, p_action: "suspend_user", p_target_type: "user", p_target_id: route.id, p_details: { reason: body.reason } });
        return withCors({ ok: true });
      }

      if (req.method === "POST" && route.action === "unsuspend" && route.id) {
        // Only lifts a suspension; a ban is lifted with unban (which also clears the sign-in ban).
        const { data, error } = await supabase
          .from("users")
          .update({ status: "active", suspended_reason: null, suspended_at: null, suspended_by: null })
          .eq("id", route.id)
          .eq("status", "suspended")
          .select("id");
        if (error) throw error;
        if (!data?.length) return withCors({ error: "User is not suspended" }, { status: 409 });
        await supabase.rpc("log_admin_action", { p_admin_id: authId, p_action: "unsuspend_user", p_target_type: "user", p_target_id: route.id });
        return withCors({ ok: true });
      }

      if (req.method === "POST" && route.action === "ban" && route.id) {
        const body = await req.json().catch(() => ({})) as { reason?: string };
        const { data, error } = await supabase
          .from("users")
          .update({ status: "banned", suspended_reason: body.reason ?? "Banned by admin", suspended_at: new Date().toISOString(), suspended_by: authId })
          .eq("id", route.id)
          .select("auth_id");
        if (error) throw error;
        if (!data?.length) return withCors({ error: "User not found" }, { status: 404 });
        const banAuthId = data[0].auth_id as string | null;
        if (banAuthId) {
          const { error: banErr } = await supabase.auth.admin.updateUserById(banAuthId, { ban_duration: AUTH_BAN_DURATION });
          if (banErr) throw banErr;
        }
        await supabase.rpc("log_admin_action", { p_admin_id: authId, p_action: "ban_user", p_target_type: "user", p_target_id: route.id, p_details: { reason: body.reason } });
        return withCors({ ok: true });
      }

      if (req.method === "POST" && route.action === "unban" && route.id) {
        const { data, error } = await supabase
          .from("users")
          .update({ status: "active", suspended_reason: null, suspended_at: null, suspended_by: null })
          .eq("id", route.id)
          .eq("status", "banned")
          .select("auth_id");
        if (error) throw error;
        if (!data?.length) return withCors({ error: "User is not banned" }, { status: 409 });
        const unbanAuthId = data[0].auth_id as string | null;
        if (unbanAuthId) {
          const { error: banErr } = await supabase.auth.admin.updateUserById(unbanAuthId, { ban_duration: "none" });
          if (banErr) throw banErr;
        }
        await supabase.rpc("log_admin_action", { p_admin_id: authId, p_action: "unban_user", p_target_type: "user", p_target_id: route.id });
        return withCors({ ok: true });
      }
    }

    // ── TRANSACTIONS ──
    if (route.resource === "transactions") {
      if (req.method === "GET" && !route.id) {
        const url = new URL(req.url);
        const { page, limit, from, to } = parsePaging(url.searchParams);
        const status = url.searchParams.get("status");
        const type = url.searchParams.get("type");
        const userId = url.searchParams.get("user_id");
        const provider = url.searchParams.get("provider");
        const currency = url.searchParams.get("currency");
        const flagged = url.searchParams.get("flagged");
        const search = cleanSearch(url.searchParams.get("search"));
        const dateFrom = url.searchParams.get("date_from");
        const dateTo = url.searchParams.get("date_to");

        let searchOr = "";
        if (search) {
          const { data: matchingUsers } = await supabase
            .from("users")
            .select("id")
            .or(orIlike(["full_name", "phone", "email"], search))
            .limit(150);
          const userIds = (matchingUsers ?? []).map((u: { id: string }) => u.id);
          const orParts = [orIlike(["idempotency_key", "provider_ref", "description"], search)];
          if (userIds.length > 0) orParts.push(`user_id.in.(${userIds.join(",")})`);
          searchOr = orParts.join(",");
        }

        // The list and the CSV export share these filters.
        const LIST_COLUMNS =
          "id, wallet_id, user_id, currency, type, amount, fee, net_amount, status, provider, provider_ref, idempotency_key, description, metadata, flagged, flag_reason, created_at, completed_at";
        const CSV_COLUMNS = "id, idempotency_key, user_id, type, amount, fee, currency, status, provider, flagged, created_at";
        const buildQuery = (count: boolean, columns = LIST_COLUMNS) => {
          let q = supabase
            .from("transactions")
            .select(columns, count ? { count: "exact" } : undefined)
            .order("created_at", { ascending: false });
          if (status) q = q.eq("status", status);
          if (type) q = q.eq("type", type);
          if (userId) q = q.eq("user_id", userId);
          if (provider) q = q.eq("provider", provider);
          if (currency) q = q.eq("currency", currency);
          if (flagged === "true") q = q.eq("flagged", true);
          if (flagged === "false") q = q.eq("flagged", false);
          if (dateFrom) q = q.gte("created_at", dateFrom);
          if (dateTo) q = q.lte("created_at", dateTo);
          if (searchOr) q = q.or(searchOr);
          return q;
        };

        if (url.searchParams.get("format") === "csv") {
          const { rows, truncated } = await exportRows(() => buildQuery(false, CSV_COLUMNS), new Date().toISOString());
          const names = await loadUsersById(supabase, rows.map((row) => row.user_id as string));
          const csvRows = rows.map((row) => ({
            id: row.id,
            reference: row.idempotency_key,
            user_name: names.get(row.user_id as string)?.full_name ?? "",
            type: row.type,
            amount: row.amount,
            fee: row.fee,
            currency: row.currency,
            status: row.status,
            provider: row.provider,
            flagged: row.flagged,
            created_at: row.created_at,
          }));
          return csvResponse(
            "transactions.csv",
            toCsv(csvRows, ["id", "reference", "user_name", "type", "amount", "fee", "currency", "status", "provider", "flagged", "created_at"]),
            truncated,
          );
        }

        const { data, count, error } = await buildQuery(true).order("id", { ascending: false }).range(from, to);
        if (error) throw error;

        const transactions = await attachUserFields(supabase, (data ?? []) as Record<string, unknown>[]);

        return withCors({ transactions, total: count, page, limit });
      }

      if (req.method === "GET" && route.id) {
        const { data: txn, error } = await supabase
          .from("transactions")
          .select("*")
          .eq("id", route.id)
          .single();
        if (error) throw error;

        const [{ data: ledgerEntries }, usersById] = await Promise.all([
          supabase
            .from("ledger_entries")
            .select("id, entry_type, amount, balance_before, balance_after, created_at")
            .eq("transaction_id", route.id)
            .order("created_at", { ascending: true }),
          loadUsersById(supabase, [txn.user_id as string]),
        ]);

        const user = usersById.get(txn.user_id as string);

        const refs = [txn.idempotency_key, txn.provider_ref].filter(Boolean) as string[];

        const pspEventsQuery = supabase
          .from("psp_events")
          .select("*")
          .order("created_at", { ascending: true });

        const { data: pspByTxn } = await pspEventsQuery.eq("transaction_id", route.id);

        let pspEvents = pspByTxn ?? [];
        if (refs.length > 0) {
          const refFilter = refs.map((r) => `reference.eq.${quoteValue(r)},provider_ref.eq.${quoteValue(r)}`).join(",");
          const { data: pspByRef } = await supabase
            .from("psp_events")
            .select("*")
            .or(refFilter)
            .order("created_at", { ascending: true });
          const seen = new Set(pspEvents.map((e: { id: string }) => e.id));
          for (const row of pspByRef ?? []) {
            if (!seen.has(row.id)) pspEvents.push(row);
          }
          pspEvents.sort((a: { created_at: string }, b: { created_at: string }) =>
            new Date(a.created_at).getTime() - new Date(b.created_at).getTime()
          );
        }

        let relatedWebhooks: Record<string, unknown>[] = [];
        if (refs.length > 0) {
          const whFilter = refs.map((r) => `idempotency_key.eq.${quoteValue(r)}`).join(",");
          const { data: webhooks } = await supabase
            .from("webhook_logs")
            .select("id, provider, event_type, processed, processing_error, signature_valid, idempotency_key, created_at, processed_at")
            .or(whFilter)
            .order("created_at", { ascending: false })
            .limit(20);
          relatedWebhooks = webhooks ?? [];
        }

        return withCors({
          transaction: {
            ...txn,
            user_name: user?.full_name ?? "",
            user_phone: user?.phone ?? "",
            user_email: user?.email ?? "",
          },
          ledger_entries: ledgerEntries ?? [],
          psp_events: pspEvents,
          related_webhooks: relatedWebhooks,
        });
      }

      if (req.method === "POST" && route.action === "flag" && route.id) {
        const body = await req.json();
        const { error } = await supabase
          .from("transactions")
          .update({
            flagged: true,
            flag_reason: body.reason ?? "Flagged by admin",
            flagged_by: authId,
            flagged_at: new Date().toISOString(),
          })
          .eq("id", route.id);
        if (error) throw error;

        await supabase.rpc("log_admin_action", { p_admin_id: authId, p_action: "flag_transaction", p_target_type: "transaction", p_target_id: route.id, p_details: { reason: body.reason } });
        return withCors({ ok: true });
      }

      if (req.method === "POST" && route.action === "unflag" && route.id) {
        const { error } = await supabase
          .from("transactions")
          .update({
            flagged: false,
            flag_reason: null,
            flagged_by: null,
            flagged_at: null,
          })
          .eq("id", route.id);
        if (error) throw error;

        await supabase.rpc("log_admin_action", { p_admin_id: authId, p_action: "unflag_transaction", p_target_type: "transaction", p_target_id: route.id });
        return withCors({ ok: true });
      }

      if (req.method === "POST" && route.action === "refund" && route.id) {
        const body = await req.json().catch(() => ({})) as { reason?: string };
        const { data: refundTxnId, error } = await supabase.rpc("admin_refund_transaction", {
          p_transaction_id: route.id,
          p_admin_auth_id: authId,
          p_reason: body.reason ?? "Admin refund",
        });
        if (error) throw error;
        return withCors({ ok: true, refund_transaction_id: refundTxnId });
      }
    }

    // ── KYC ── read-only: verification is automated (Dojah), admins only see results.
    if (route.resource === "kyc") {
      if (req.method === "GET" && !route.id) {
        const url = new URL(req.url);
        const status = url.searchParams.get("status");
        const { page, limit, from, to } = parsePaging(url.searchParams);

        let query = supabase
          .from("kyc_verifications")
          .select("id, user_id, level, status, provider, bvn_last_four, nin_last_four, selfie_match_confidence, submitted_at, verified_at, reviewed_by, rejection_reason, created_at", { count: "exact" })
          .order("created_at", { ascending: false })
          .order("id", { ascending: false })
          .range(from, to);
        if (status && status !== "all") query = query.eq("status", status);

        const { data, count, error } = await query;
        if (error) throw error;
        const submissions = await attachUserFields(supabase, data ?? []);
        return withCors({ submissions, total: count, page, limit });
      }
    }

    // ── EVENTS ──
    if (route.resource === "events") {
      if (req.method === "GET" && !route.id) {
        const url = new URL(req.url);
        const { page, limit, from, to } = parsePaging(url.searchParams);
        const status = url.searchParams.get("status");

        const EVENT_STATUSES = new Set(["draft", "scheduled", "live", "ended"]);
        const statuses = (status ?? "").split(",").map((v) => v.trim()).filter((v) => EVENT_STATUSES.has(v));
        // A status filter with no real status in it matches nothing (not everything).
        if (status && statuses.length === 0) return withCors({ events: [], total: 0, page, limit });

        let query = supabase
          .from("events")
          .select(
            "id, host_id, title, event_code, type, status, is_private, max_participants, participant_count, total_sprayed, flagged, flag_reason, created_at, started_at, ended_at, scheduled_at",
            { count: "exact" },
          )
          .order("created_at", { ascending: false })
          .order("id", { ascending: false })
          .range(from, to);

        if (statuses.length) query = query.in("status", statuses);
        if (url.searchParams.get("flagged") === "true") query = query.eq("flagged", true);

        const { data, count, error } = await query;
        if (error) throw error;
        const hosts = await loadUsersById(supabase, (data ?? []).map((e) => e.host_id as string));
        const events = (data ?? []).map((e) => ({ ...e, host_name: hosts.get(e.host_id as string)?.full_name ?? "" }));
        return withCors({ events, total: count, page, limit });
      }

      if (req.method === "POST" && route.action === "flag" && route.id) {
        const body = await req.json().catch(() => ({})) as { reason?: string };
        const { data, error } = await supabase
          .from("events")
          .update({ flagged: true, flag_reason: body.reason ?? "Flagged by admin", flagged_by: authId, flagged_at: new Date().toISOString() })
          .eq("id", route.id)
          .select("id");
        if (error) throw error;
        if (!data?.length) return withCors({ error: "Event not found" }, { status: 404 });
        await supabase.rpc("log_admin_action", { p_admin_id: authId, p_action: "flag_event", p_target_type: "event", p_target_id: route.id, p_details: { reason: body.reason } });
        return withCors({ ok: true });
      }

      if (req.method === "POST" && route.action === "unflag" && route.id) {
        const { data, error } = await supabase
          .from("events")
          .update({ flagged: false, flag_reason: null, flagged_by: null, flagged_at: null })
          .eq("id", route.id)
          .select("id");
        if (error) throw error;
        if (!data?.length) return withCors({ error: "Event not found" }, { status: 404 });
        await supabase.rpc("log_admin_action", { p_admin_id: authId, p_action: "unflag_event", p_target_type: "event", p_target_id: route.id });
        return withCors({ ok: true });
      }

      if (req.method === "POST" && route.action === "end" && route.id) {
        const { error } = await supabase
          .from("events")
          .update({ status: "ended", ended_at: new Date().toISOString() })
          .eq("id", route.id);
        if (error) throw error;
        await supabase.rpc("log_admin_action", { p_admin_id: authId, p_action: "end_event", p_target_type: "event", p_target_id: route.id });
        return withCors({ ok: true });
      }
    }

    // ── TEAM ── (super admins only, via the matrix)
    if (route.resource === "team") {
      if (req.method === "GET") {
        const { data, error } = await supabase
          .from("admin_roles")
          .select("id, user_id, role, status, invited_email, last_login_at, created_at")
          .order("created_at", { ascending: false });
        if (error) throw error;
        const team = await Promise.all((data ?? []).map(async (m) => {
          let email = (m.invited_email as string | null) ?? "";
          if (!email) {
            const { data: u } = await supabase.auth.admin.getUserById(m.user_id as string);
            email = u?.user?.email ?? "";
          }
          return { ...m, email };
        }));
        return withCors({ team });
      }

      if (req.method === "POST" && route.action === "invite") {
        const body = await req.json().catch(() => ({})) as { email?: string; role?: string };
        const email = (body.email ?? "").trim().toLowerCase();
        if (!email || !body.role) return withCors({ error: "email and role are required" }, { status: 400 });
        if (!isAdminRole(body.role)) return withCors({ error: "Unknown role" }, { status: 400 });

        let inviteeId = await findAuthUserIdByEmail(supabase, email);
        if (inviteeId) {
          const { data: existing } = await supabase.from("admin_roles").select("id").eq("user_id", inviteeId).limit(1);
          if (existing?.length) return withCors({ error: "This person is already on the team" }, { status: 409 });
        } else {
          const origin = req.headers.get("origin");
          const { data: invited, error: inviteErr } = await supabase.auth.admin.inviteUserByEmail(email, {
            redirectTo: origin ? `${origin}/admin/change-password` : undefined,
            data: { admin_invite: true },
          });
          if (inviteErr || !invited?.user) {
            return withCors({ error: "Couldn't send the invite", detail: inviteErr?.message }, { status: 502 });
          }
          inviteeId = invited.user.id;
        }

        const { data: row, error } = await supabase.from("admin_roles").insert({
          user_id: inviteeId,
          role: body.role,
          invited_by: authId,
          invited_email: email,
          status: "invited",
          must_change_password: true,
        }).select("id").single();
        if (error) throw error;

        await supabase.rpc("log_admin_action", { p_admin_id: authId, p_action: "invite_admin", p_target_type: "admin", p_target_id: row.id, p_details: { email, role: body.role } });
        return withCors({ ok: true }, { status: 201 });
      }

      if (req.method === "POST" && route.id && ["disable", "enable", "role"].includes(route.action ?? "")) {
        const { data: target, error: targetErr } = await supabase
          .from("admin_roles")
          .select("id, user_id, role, status")
          .eq("id", route.id)
          .maybeSingle();
        if (targetErr) throw targetErr;
        if (!target) return withCors({ error: "Team member not found" }, { status: 404 });

        if (route.action === "enable") {
          const { error } = await supabase.from("admin_roles").update({ status: "active" }).eq("id", route.id);
          if (error) throw error;
          await supabase.rpc("log_admin_action", { p_admin_id: authId, p_action: "enable_admin", p_target_type: "admin", p_target_id: route.id });
          return withCors({ ok: true });
        }

        const body = route.action === "role"
          ? await req.json().catch(() => ({})) as { role?: string }
          : {};
        if (route.action === "role" && !body.role) return withCors({ error: "role is required" }, { status: 400 });

        // Only an active super admin counts towards "the last one".
        const reason = teamChangeAllowed({
          actorAuthId: authId,
          targetUserId: target.user_id as string,
          targetRole: target.status === "active" ? target.role as string : "inactive",
          newRole: route.action === "role" ? body.role : undefined,
          disable: route.action === "disable",
          activeSuperAdmins: await countActiveSuperAdmins(supabase),
        });
        if (reason) return withCors({ error: reason }, { status: 409 });

        if (route.action === "disable") {
          const { error } = await supabase.from("admin_roles").update({ status: "disabled" }).eq("id", route.id);
          if (error) throw error;
          await supabase.rpc("log_admin_action", { p_admin_id: authId, p_action: "disable_admin", p_target_type: "admin", p_target_id: route.id });
          return withCors({ ok: true });
        }

        const { error } = await supabase.from("admin_roles").update({ role: body.role }).eq("id", route.id);
        if (error?.code === "23505") return withCors({ error: "This person already has that role" }, { status: 409 });
        if (error) throw error;
        await supabase.rpc("log_admin_action", { p_admin_id: authId, p_action: "change_admin_role", p_target_type: "admin", p_target_id: route.id, p_details: { from: target.role, to: body.role } });
        return withCors({ ok: true });
      }
    }

    // ── PAYMENT RAILS ──
    if (route.resource === "payment-rails") {

      if (req.method === "GET" && route.action === "health" && route.id) {
        const platform = await getPlatformPaymentSettings(supabase);
        const health = await probeProviderHealth(route.id, platform.pspEnv);
        return withCors({ provider_id: route.id, psp_env: platform.pspEnv, ...health });
      }

      if (req.method === "GET" && !route.action) {
        const [providersRes, settings, healthRes] = await Promise.all([
          supabase
            .from("psp_providers")
            .select("id, display_name, capabilities, status, config_schema, updated_at")
            .order("display_name"),
          getPlatformPaymentSettings(supabase),
          supabase
            .from("provider_health")
            .select("provider_id, ok, message, checked_at")
            .order("checked_at", { ascending: false })
            .limit(20),
        ]);

        if (providersRes.error) throw providersRes.error;

        const latestHealth = new Map<string, { ok: boolean; message: string; checked_at: string }>();
        for (const row of healthRes.data ?? []) {
          if (!latestHealth.has(row.provider_id as string)) {
            latestHealth.set(row.provider_id as string, {
              ok: row.ok as boolean,
              message: row.message as string,
              checked_at: row.checked_at as string,
            });
          }
        }

        return withCors({
          providers: providersRes.data ?? [],
          settings: {
            wallet_funding_provider_id: settings.walletFundingProviderId,
            disbursement_provider_id: settings.disbursementProviderId,
            psp_env: settings.pspEnv,
          },
          provider_health: [...latestHealth.entries()].map(([provider_id, h]) => ({ provider_id, ...h })),
        });
      }

      if (req.method === "POST" && route.action === "probe-all") {
        const platform = await getPlatformPaymentSettings(supabase);
        const { data: providers } = await supabase.from("psp_providers").select("id").in("status", ["active", "sandbox_only"]);
        const results: Record<string, unknown>[] = [];

        for (const p of providers ?? []) {
          const providerId = p.id as string;
          const health = await probeProviderHealth(providerId, platform.pspEnv);
          await supabase.from("provider_health").insert({
            provider_id: providerId,
            capability: "general",
            ok: health.ok,
            message: health.message,
            details: health.details ?? null,
          });
          results.push({ provider_id: providerId, ...health });
        }

        await supabase.rpc("log_admin_action", {
          p_admin_id: authId,
          p_action: "probe_all_providers",
          p_target_type: "platform_settings",
          p_details: { count: results.length },
        });

        return withCors({ ok: true, results });
      }
    }

    // ── PAYMENTS OVERVIEW ──
    if (route.resource === "payments" && req.method === "GET" && !route.id) {

      const now = new Date();
      const todayStart = new Date(now);
      todayStart.setUTCHours(0, 0, 0, 0);
      const since24h = new Date(now.getTime() - 24 * 60 * 60 * 1000);

      const [
        depositsToday,
        withdrawalsToday,
        pendingWd,
        processingWd,
        failed24h,
        unprocessedWebhooks,
        recentFailures,
        platformSettings,
        providerHealthRes,
        moneyRes,
        treasuryRes,
        topupsRes,
      ] = await Promise.all([
        supabase
          .from("transactions")
          .select("id, amount, provider, currency", { count: "exact" })
          .eq("type", "deposit")
          .eq("status", "completed")
          .gte("created_at", todayStart.toISOString()),
        supabase
          .from("transactions")
          .select("id, amount, provider, currency", { count: "exact" })
          .eq("type", "withdrawal")
          .in("status", ["completed", "processing", "pending"])
          .gte("created_at", todayStart.toISOString()),
        supabase
          .from("transactions")
          .select("id", { count: "exact", head: true })
          .eq("type", "withdrawal")
          .eq("status", "pending"),
        supabase
          .from("transactions")
          .select("id", { count: "exact", head: true })
          .eq("type", "withdrawal")
          .eq("status", "processing"),
        supabase
          .from("transactions")
          .select("id", { count: "exact", head: true })
          .in("type", ["deposit", "withdrawal"])
          .eq("status", "failed")
          .gte("created_at", since24h.toISOString()),
        supabase
          .from("webhook_logs")
          .select("id", { count: "exact", head: true })
          .eq("processed", false),
        supabase
          .from("transactions")
          .select("id, type, amount, currency, provider, status, idempotency_key, created_at, user_id")
          .in("type", ["deposit", "withdrawal"])
          .eq("status", "failed")
          .order("created_at", { ascending: false })
          .limit(8),
        getPlatformPaymentSettings(supabase),
        supabase
          .from("provider_health")
          .select("provider_id, ok, message, checked_at")
          .order("checked_at", { ascending: false })
          .limit(10),
        supabase.rpc("admin_money_overview"),
        // get_treasury_balances() checks auth.uid(), which a service-role call doesn't have, so read
        // the treasury wallets directly (the treasury user id from migration 083).
        supabase.from("wallets").select("currency, balance, locked_balance").eq("user_id", TREASURY_USER_ID),
        supabase
          .from("treasury_topups")
          .select("id, currency, amount, reference, note, created_at")
          .order("created_at", { ascending: false })
          .limit(20),
      ]);
      if (moneyRes.error) throw moneyRes.error;
      if (treasuryRes.error) throw treasuryRes.error;
      if (topupsRes.error) throw topupsRes.error;
      // Treasury balances and top-ups are finance data (get_treasury_balances allows super admin and
      // finance only); support sees the rest of the overview.
      const seesTreasury = can(role, "transactions.write");

      const sumVolume = (rows: { amount: number; currency: string }[] | null) =>
        (rows ?? []).reduce((s, r) => s + Math.abs(r.amount), 0);

      const providerMap = new Map<string, { deposits: number; withdrawals: number; failed: number }>();
      for (const row of depositsToday.data ?? []) {
        const p = (row.provider as string) ?? "unknown";
        const cur = providerMap.get(p) ?? { deposits: 0, withdrawals: 0, failed: 0 };
        cur.deposits += Math.abs(row.amount as number);
        providerMap.set(p, cur);
      }
      for (const row of withdrawalsToday.data ?? []) {
        const p = (row.provider as string) ?? "unknown";
        const cur = providerMap.get(p) ?? { deposits: 0, withdrawals: 0, failed: 0 };
        cur.withdrawals += Math.abs(row.amount as number);
        providerMap.set(p, cur);
      }

      const healthLatest = new Map<string, { ok: boolean; message: string; checked_at: string }>();
      for (const row of providerHealthRes.data ?? []) {
        const pid = row.provider_id as string;
        if (!healthLatest.has(pid)) {
          healthLatest.set(pid, {
            ok: row.ok as boolean,
            message: row.message as string,
            checked_at: row.checked_at as string,
          });
        }
      }

      return withCors({
        today: {
          deposits: { count: depositsToday.count ?? 0, volume_kobo: sumVolume(depositsToday.data as { amount: number; currency: string }[]) },
          withdrawals: { count: withdrawalsToday.count ?? 0, volume_kobo: sumVolume(withdrawalsToday.data as { amount: number; currency: string }[]) },
        },
        queues: {
          pending_withdrawals: pendingWd.count ?? 0,
          processing_withdrawals: processingWd.count ?? 0,
          failed_24h: failed24h.count ?? 0,
          unprocessed_webhooks: unprocessedWebhooks.count ?? 0,
        },
        platform: {
          wallet_funding_provider_id: platformSettings.walletFundingProviderId,
          disbursement_provider_id: platformSettings.disbursementProviderId,
          psp_env: platformSettings.pspEnv,
        },
        by_provider: [...providerMap.entries()].map(([provider, stats]) => ({ provider, ...stats })),
        recent_failures: await (async () => {
          const rows = recentFailures.data ?? [];
          const usersById = await loadUsersById(
            supabase,
            rows.map((row: { user_id?: string }) => row.user_id as string),
          );
          return rows.map((row: Record<string, unknown>) => ({
            id: row.id,
            type: row.type,
            amount: row.amount,
            currency: row.currency,
            provider: row.provider,
            reference: row.idempotency_key,
            user_name: usersById.get(row.user_id as string)?.full_name ?? "",
            created_at: row.created_at,
          }));
        })(),
        provider_health: [...healthLatest.entries()].map(([provider_id, h]) => ({ provider_id, ...h })),
        money: moneyRes.data ?? null,
        treasury: seesTreasury ? treasuryRes.data ?? [] : null,
        recent_topups: seesTreasury ? topupsRes.data ?? [] : null,
      });
    }

    // ── WEBHOOK LOGS ──
    if (route.resource === "webhooks") {

      if (req.method === "GET" && route.id) {
        const { data, error } = await supabase
          .from("webhook_logs")
          .select("*")
          .eq("id", route.id)
          .single();
        if (error) throw error;
        return withCors({ webhook: data });
      }

      if (req.method === "GET" && !route.id) {
        const url = new URL(req.url);
        const { page, limit, from, to } = parsePaging(url.searchParams);
        const provider = url.searchParams.get("provider");
        const processed = url.searchParams.get("processed");
        const eventType = cleanSearch(url.searchParams.get("event_type"));
        const search = orIlike(["idempotency_key", "event_type"], url.searchParams.get("search"));

        const buildQuery = (count: boolean) => {
          let q = supabase
            .from("webhook_logs")
            .select(
              "id, provider, event_type, processed, processing_error, signature_valid, idempotency_key, created_at, processed_at",
              count ? { count: "exact" } : undefined,
            )
            .order("created_at", { ascending: false });
          if (provider) q = q.eq("provider", provider);
          if (processed === "true") q = q.eq("processed", true);
          if (processed === "false") q = q.eq("processed", false);
          if (eventType) q = q.ilike("event_type", `%${escapeLikePattern(eventType)}%`);
          if (search) q = q.or(search);
          return q;
        };

        if (url.searchParams.get("format") === "csv") {
          const { rows, truncated } = await exportRows(() => buildQuery(false), new Date().toISOString());
          const csvRows = rows.map((row: Record<string, unknown>) => ({
            id: row.id,
            provider: row.provider,
            event_type: row.event_type,
            processed: row.processed,
            processing_error: row.processing_error,
            idempotency_key: row.idempotency_key,
            created_at: row.created_at,
          }));
          return csvResponse(
            "webhooks.csv",
            toCsv(csvRows, ["id", "provider", "event_type", "processed", "processing_error", "idempotency_key", "created_at"]),
            truncated,
          );
        }

        const { data, count, error } = await buildQuery(true).order("id", { ascending: false }).range(from, to);
        if (error) throw error;

        return withCors({ webhooks: data, total: count, page, limit });
      }

      if (req.method === "POST" && route.action === "reprocess" && route.id) {

        const { data: webhook, error } = await supabase
          .from("webhook_logs")
          .select("id, provider, event_type, payload")
          .eq("id", route.id)
          .single();
        if (error || !webhook) throw error ?? new Error("Webhook not found");

        await supabase
          .from("webhook_logs")
          .update({ processed: false, processing_error: null, processed_at: null })
          .eq("id", route.id);

        const result = await reprocessWebhookLog(supabase, {
          id: webhook.id as string,
          provider: webhook.provider as string,
          event_type: webhook.event_type as string | null,
          payload: webhook.payload as Record<string, unknown>,
        });

        await supabase.rpc("log_admin_action", {
          p_admin_id: authId,
          p_action: "reprocess_webhook",
          p_target_type: "webhook",
          p_target_id: route.id,
          p_details: result,
        });

        return withCors({ ok: result.ok, message: result.message });
      }
    }

    // ── REVIEW QUEUE ──
    if (route.resource === "queue" && req.method === "GET") {

      const cutoff = new Date(Date.now() - STUCK_AFTER_MINUTES * 60 * 1000).toISOString();

      const [stuckWithdrawals, unprocessedWebhooks, flaggedTxns, needsReview, paidFailed, pendingFloat] = await Promise.all([
        supabase
          .from("transactions")
          .select("id, type, amount, currency, provider, status, idempotency_key, created_at, user_id")
          .eq("type", "withdrawal")
          .in("status", ["pending", "processing"])
          .lt("created_at", cutoff)
          .order("created_at", { ascending: true })
          .limit(50),
        supabase
          .from("webhook_logs")
          .select("id, provider, event_type, processing_error, idempotency_key, created_at")
          .eq("processed", false)
          .order("created_at", { ascending: true })
          .limit(50),
        supabase
          .from("transactions")
          .select("id, type, amount, currency, provider, status, idempotency_key, flag_reason, created_at, user_id")
          .eq("flagged", true)
          .order("flagged_at", { ascending: false })
          .limit(50),
        supabase
          .from("transactions")
          .select("id, type, amount, currency, provider, status, idempotency_key, created_at, user_id")
          .eq("type", "withdrawal")
          .in("status", ["pending", "processing"])
          .eq("metadata->>needs_review", "true")
          .order("created_at", { ascending: true })
          .limit(50),
        supabase
          .from("bundle_orders")
          .select("id, currency, amount, status, tx_ref, provider_ref, failure_reason, created_at, user_id")
          .eq("currency", "NGN")
          .eq("status", "failed")
          .not("provider_ref", "is", null)
          .neq("provider_ref", "")
          .is("refunded_at", null)
          .order("created_at", { ascending: true })
          .limit(50),
        supabase
          .from("bundle_orders")
          .select("id, currency, amount, status, tx_ref, failure_reason, created_at, user_id")
          .eq("status", "pending_float")
          .order("created_at", { ascending: true })
          .limit(50),
      ]);

      const stuckRows = await attachUserFields(supabase, stuckWithdrawals.data ?? []);
      const flaggedRows = await attachUserFields(supabase, flaggedTxns.data ?? []);

      return withCors({
        stuck_withdrawals: stuckRows,
        unprocessed_webhooks: unprocessedWebhooks.data ?? [],
        flagged_transactions: flaggedRows,
        payouts_needing_review: await attachUserFields(supabase, needsReview.data ?? []),
        orders_paid_failed: await attachUserFields(supabase, paidFailed.data ?? []),
        orders_pending_float: await attachUserFields(supabase, pendingFloat.data ?? []),
      });
    }

    // ── PSP EVENTS ──
    if (route.resource === "psp-events" && req.method === "GET") {

      const url = new URL(req.url);
      const { page, limit, from, to } = parsePaging(url.searchParams);
      const provider = url.searchParams.get("provider");
      const direction = url.searchParams.get("direction");
      const search = orIlike(["reference", "provider_ref", "event_type"], url.searchParams.get("search"));

      const buildQuery = (count: boolean, columns = "*") => {
        let q = supabase
          .from("psp_events")
          .select(columns, count ? { count: "exact" } : undefined)
          .order("created_at", { ascending: false });
        if (provider) q = q.eq("provider_id", provider);
        if (direction) q = q.eq("direction", direction);
        if (search) q = q.or(search);
        return q;
      };

      if (url.searchParams.get("format") === "csv") {
        const { rows, truncated } = await exportRows(
          () => buildQuery(false, "id, provider_id, direction, event_type, status, reference, created_at"),
          new Date().toISOString(),
        );
        const csvRows = rows.map((row: Record<string, unknown>) => ({
          id: row.id,
          provider_id: row.provider_id,
          direction: row.direction,
          event_type: row.event_type,
          status: row.status,
          reference: row.reference,
          created_at: row.created_at,
        }));
        return csvResponse(
          "psp-events.csv",
          toCsv(csvRows, ["id", "provider_id", "direction", "event_type", "status", "reference", "created_at"]),
          truncated,
        );
      }

      const { data, count, error } = await buildQuery(true).order("id", { ascending: false }).range(from, to);
      if (error) throw error;

      return withCors({ events: data, total: count, page, limit });
    }

    // ── AUDIT LOG ──
    if (route.resource === "audit" && req.method === "GET") {
      const url = new URL(req.url);
      const { page, limit, from, to } = parsePaging(url.searchParams);

      const action = url.searchParams.get("action");
      const adminId = url.searchParams.get("admin_id");

      let query = supabase
        .from("admin_audit_log")
        .select("id, admin_user_id, action, target_type, target_id, details, created_at", { count: "exact" })
        .order("created_at", { ascending: false })
        .order("id", { ascending: false })
        .range(from, to);
      if (action) query = query.eq("action", action);
      if (adminId) query = query.eq("admin_user_id", adminId);

      const { data, count, error } = await query;
      if (error) throw error;

      const emails = new Map<string, string>();
      await Promise.all([...new Set((data ?? []).map((r) => r.admin_user_id as string))].map(async (id) => {
        const { data: u } = await supabase.auth.admin.getUserById(id);
        emails.set(id, u?.user?.email ?? "");
      }));
      const logs = (data ?? []).map((r) => ({ ...r, admin_email: emails.get(r.admin_user_id as string) ?? "" }));
      return withCors({ logs, total: count, page, limit });
    }

    return withCors({ error: "Not found" }, { status: 404 });
  } catch (err) {
    // A page past the end of the list: PostgREST refuses the range.
    if (typeof err === "object" && err && (err as { code?: string }).code === "PGRST103") {
      return withCors({ error: "That page is past the end of the list" }, { status: 400 });
    }
    const detail = err instanceof Error
      ? err.message
      : typeof err === "object" && err && "message" in err
      ? String((err as { message: unknown }).message)
      : String(err);
    return withCors({ error: "Admin API error", detail }, { status: 500 });
  }
});
