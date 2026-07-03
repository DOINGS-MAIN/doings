import { corsHeaders, withCors } from "../_shared/cors.ts";
import { getAuthUserIdFromRequest, getServiceClient } from "../_shared/db.ts";
import type { SupabaseClient } from "https://esm.sh/@supabase/supabase-js@2.49.8";
import { getPlatformPaymentSettings } from "../_shared/psp/platformSettings.ts";
import { probeProviderHealth } from "../_shared/psp/registry.ts";
import { reprocessWebhookLog } from "../_shared/reprocessWebhook.ts";

const STUCK_AFTER_MINUTES = Number(Deno.env.get("WITHDRAWAL_RECONCILE_MINUTES") ?? "15");

const RESERVED_ACTIONS = new Set([
  "suspend", "unsuspend", "ban", "flag", "unflag", "approve", "reject", "end",
  "invite", "disable", "enable", "refund", "reprocess", "export", "probe-all", "health",
]);

function canWritePayments(role: string): boolean {
  return role === "super_admin" || role === "finance";
}

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

function csvResponse(filename: string, body: string): Response {
  return new Response(body, {
    headers: {
      ...corsHeaders,
      "Content-Type": "text/csv; charset=utf-8",
      "Content-Disposition": `attachment; filename="${filename}"`,
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

  const { data, error } = await supabase
    .from("users")
    .select("id, full_name, phone, email")
    .in("id", unique);

  if (error) throw error;

  return new Map((data ?? []).map((row) => [row.id as string, row as UserSummary]));
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

  if (["users", "transactions", "kyc", "events", "team", "audit"].includes(resource)) {
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
  const { data: adminRole } = await supabase
    .from("admin_roles")
    .select("role, status")
    .eq("user_id", authUserId)
    .eq("status", "active")
    .maybeSingle();

  if (!adminRole) throw { status: 403, message: "Not an admin" };

  return { authId: authUserId, role: adminRole.role as string, supabase };
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

  const { supabase, authId, role } = admin;
  const route = parseRoute(req.url);

  try {
    // ── STATS ──
    if (route.resource === "stats" && req.method === "GET") {
      const today = new Date();
      today.setUTCHours(0, 0, 0, 0);

      const [users, txns, events, kyc, feeStatsRes] = await Promise.all([
        supabase.from("users").select("id, status", { count: "exact", head: false }),
        supabase.from("transactions").select("id, amount, status, created_at", { count: "exact", head: false })
          .eq("status", "completed").gt("amount", 0),
        supabase.from("events").select("id, status", { count: "exact", head: false }),
        supabase.from("kyc_verifications").select("id", { count: "exact", head: true }).eq("status", "pending"),
        supabase.rpc("get_fee_revenue_stats"),
      ]);

      const todayTxns = (txns.data ?? []).filter((t: { created_at: string }) => new Date(t.created_at) >= today);
      const feeStats = (feeStatsRes.data ?? {}) as { total_fee_kobo?: number; today_fee_kobo?: number };

      return withCors({
        totalUsers: users.count ?? 0,
        activeUsers: (users.data ?? []).filter((u: { status: string }) => u.status === "active").length,
        suspendedUsers: (users.data ?? []).filter((u: { status: string }) => u.status === "suspended" || u.status === "banned").length,
        pendingKYC: kyc.count ?? 0,
        totalTransactions: txns.count ?? 0,
        totalVolume: (txns.data ?? []).reduce((s: number, t: { amount: number }) => s + Math.abs(t.amount), 0),
        todayVolume: todayTxns.reduce((s: number, t: { amount: number }) => s + Math.abs(t.amount), 0),
        totalFeeRevenue: Number(feeStats.total_fee_kobo ?? 0),
        todayFeeRevenue: Number(feeStats.today_fee_kobo ?? 0),
        activeEvents: (events.data ?? []).filter((e: { status: string }) => e.status === "live").length,
        totalEvents: events.count ?? 0,
      });
    }

    // ── USERS ──
    if (route.resource === "users") {
      if (req.method === "GET" && !route.id) {
        const url = new URL(req.url);
        const page = Number(url.searchParams.get("page") ?? 1);
        const limit = Math.min(Number(url.searchParams.get("limit") ?? 50), 100);
        const status = url.searchParams.get("status");
        const search = url.searchParams.get("search");

        let query = supabase
          .from("users")
          .select("id, phone, email, full_name, kyc_level, status, suspended_reason, last_active_at, created_at", { count: "exact" })
          .order("created_at", { ascending: false })
          .range((page - 1) * limit, page * limit - 1);

        if (status) query = query.eq("status", status);
        if (search) query = query.or(`phone.ilike.%${search}%,full_name.ilike.%${search}%,email.ilike.%${search}%`);

        const { data, count, error } = await query;
        if (error) throw error;
        return withCors({ users: data, total: count, page, limit });
      }

      if (req.method === "GET" && route.id) {
        const { data, error } = await supabase
          .from("users")
          .select("*, wallets(id, currency, balance, locked_balance)")
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
        const { error } = await supabase
          .from("users")
          .update({ status: "active", suspended_reason: null, suspended_at: null, suspended_by: null })
          .eq("id", route.id);
        if (error) throw error;
        await supabase.rpc("log_admin_action", { p_admin_id: authId, p_action: "unsuspend_user", p_target_type: "user", p_target_id: route.id });
        return withCors({ ok: true });
      }

      if (req.method === "POST" && route.action === "ban" && route.id) {
        const body = await req.json();
        const { error } = await supabase
          .from("users")
          .update({ status: "banned", suspended_reason: body.reason ?? "Banned by admin", suspended_at: new Date().toISOString(), suspended_by: authId })
          .eq("id", route.id);
        if (error) throw error;
        await supabase.rpc("log_admin_action", { p_admin_id: authId, p_action: "ban_user", p_target_type: "user", p_target_id: route.id, p_details: { reason: body.reason } });
        return withCors({ ok: true });
      }
    }

    // ── TRANSACTIONS ──
    if (route.resource === "transactions") {
      if (req.method === "GET" && !route.id) {
        const url = new URL(req.url);
        const page = Number(url.searchParams.get("page") ?? 1);
        const limit = Math.min(Number(url.searchParams.get("limit") ?? 50), 100);
        const status = url.searchParams.get("status");
        const type = url.searchParams.get("type");
        const userId = url.searchParams.get("user_id");
        const provider = url.searchParams.get("provider");
        const currency = url.searchParams.get("currency");
        const flagged = url.searchParams.get("flagged");
        const search = url.searchParams.get("search")?.trim();
        const dateFrom = url.searchParams.get("date_from");
        const dateTo = url.searchParams.get("date_to");

        let query = supabase
          .from("transactions")
          .select(
            "id, wallet_id, user_id, currency, type, amount, fee, net_amount, status, provider, provider_ref, idempotency_key, description, metadata, flagged, flag_reason, created_at, completed_at",
            { count: "exact" },
          )
          .order("created_at", { ascending: false })
          .range((page - 1) * limit, page * limit - 1);

        if (status) query = query.eq("status", status);
        if (type) query = query.eq("type", type);
        if (userId) query = query.eq("user_id", userId);
        if (provider) query = query.eq("provider", provider);
        if (currency) query = query.eq("currency", currency);
        if (flagged === "true") query = query.eq("flagged", true);
        if (flagged === "false") query = query.eq("flagged", false);
        if (dateFrom) query = query.gte("created_at", dateFrom);
        if (dateTo) query = query.lte("created_at", dateTo);

        if (search) {
          const { data: matchingUsers } = await supabase
            .from("users")
            .select("id")
            .or(`full_name.ilike.%${search}%,phone.ilike.%${search}%,email.ilike.%${search}%`);
          const userIds = (matchingUsers ?? []).map((u: { id: string }) => u.id);
          const orParts = [
            `idempotency_key.ilike.%${search}%`,
            `provider_ref.ilike.%${search}%`,
            `description.ilike.%${search}%`,
          ];
          if (userIds.length > 0) {
            orParts.push(`user_id.in.(${userIds.join(",")})`);
          }
          query = query.or(orParts.join(","));
        }

        const { data, count, error } = await query;
        if (error) throw error;

        const transactions = await attachUserFields(supabase, data ?? []);

        if (url.searchParams.get("format") === "csv") {
          const csvRows = transactions.map((row: Record<string, unknown>) => ({
            id: row.id,
            reference: row.idempotency_key,
            user_name: row.user_name,
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
          );
        }

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
          const refFilter = refs.map((r) => `reference.eq.${r},provider_ref.eq.${r}`).join(",");
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
          const whFilter = refs.map((r) => `idempotency_key.eq.${r}`).join(",");
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
        if (!canWritePayments(role)) return withCors({ error: "Finance or super admin required" }, { status: 403 });
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
        if (!canWritePayments(role)) return withCors({ error: "Finance or super admin required" }, { status: 403 });
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
        if (!canWritePayments(role)) return withCors({ error: "Finance or super admin required" }, { status: 403 });
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

    // ── KYC ──
    if (route.resource === "kyc") {
      if (req.method === "GET" && !route.id) {
        const url = new URL(req.url);
        const status = url.searchParams.get("status") ?? "pending";
        const page = Number(url.searchParams.get("page") ?? 1);
        const limit = Math.min(Number(url.searchParams.get("limit") ?? 50), 100);

        const { data, count, error } = await supabase
          .from("kyc_verifications")
          .select("id, user_id, level, status, provider, bvn_last_four, nin_last_four, selfie_match_confidence, submitted_at, verified_at, reviewed_by, rejection_reason, created_at", { count: "exact" })
          .eq("status", status)
          .order("created_at", { ascending: false })
          .range((page - 1) * limit, page * limit - 1);

        if (error) throw error;
        return withCors({ submissions: data, total: count, page, limit });
      }

      if (req.method === "POST" && route.action === "approve" && route.id) {
        const { error } = await supabase
          .from("kyc_verifications")
          .update({ status: "verified", reviewed_by: authId, reviewed_at: new Date().toISOString(), verified_at: new Date().toISOString() })
          .eq("id", route.id);
        if (error) throw error;
        await supabase.rpc("log_admin_action", { p_admin_id: authId, p_action: "approve_kyc", p_target_type: "kyc", p_target_id: route.id });
        return withCors({ ok: true });
      }

      if (req.method === "POST" && route.action === "reject" && route.id) {
        const body = await req.json();
        const { error } = await supabase
          .from("kyc_verifications")
          .update({ status: "rejected", reviewed_by: authId, reviewed_at: new Date().toISOString(), rejection_reason: body.reason ?? "Rejected by admin" })
          .eq("id", route.id);
        if (error) throw error;
        await supabase.rpc("log_admin_action", { p_admin_id: authId, p_action: "reject_kyc", p_target_type: "kyc", p_target_id: route.id, p_details: { reason: body.reason } });
        return withCors({ ok: true });
      }
    }

    // ── EVENTS ──
    if (route.resource === "events") {
      if (req.method === "GET" && !route.id) {
        const url = new URL(req.url);
        const page = Number(url.searchParams.get("page") ?? 1);
        const limit = Math.min(Number(url.searchParams.get("limit") ?? 50), 100);
        const status = url.searchParams.get("status");

        let query = supabase
          .from("events")
          .select("id, host_id, title, code, type, status, is_public, max_participants, created_at, started_at, ended_at", { count: "exact" })
          .order("created_at", { ascending: false })
          .range((page - 1) * limit, page * limit - 1);

        if (status) query = query.eq("status", status);

        const { data, count, error } = await query;
        if (error) throw error;
        return withCors({ events: data, total: count, page, limit });
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

    // ── TEAM ──
    if (route.resource === "team") {
      if (req.method === "GET") {
        const { data, error } = await supabase
          .from("admin_roles")
          .select("id, user_id, role, status, invited_email, last_login_at, created_at")
          .order("created_at", { ascending: false });
        if (error) throw error;
        return withCors({ team: data });
      }

      if (req.method === "POST" && route.action === "invite") {
        if (role !== "super_admin") return withCors({ error: "Only super admins can invite team members" }, { status: 403 });
        const body = await req.json();
        if (!body.email || !body.role) return withCors({ error: "email and role are required" }, { status: 400 });

        const { data: authUser } = await supabase.auth.admin.createUser({
          email: body.email,
          password: crypto.randomUUID(),
          email_confirm: true,
          user_metadata: { role: body.role, invited: true },
        });

        if (!authUser?.user) return withCors({ error: "Failed to create auth user" }, { status: 500 });

        const { error } = await supabase.from("admin_roles").insert({
          user_id: authUser.user.id,
          role: body.role,
          invited_by: authId,
          invited_email: body.email,
          status: "invited",
          must_change_password: true,
        });
        if (error) throw error;

        await supabase.rpc("log_admin_action", { p_admin_id: authId, p_action: "invite_admin", p_target_type: "admin", p_details: { email: body.email, role: body.role } });
        return withCors({ ok: true }, { status: 201 });
      }

      if (req.method === "POST" && route.action === "disable" && route.id) {
        if (role !== "super_admin") return withCors({ error: "Only super admins can disable team members" }, { status: 403 });
        const { error } = await supabase.from("admin_roles").update({ status: "disabled" }).eq("id", route.id);
        if (error) throw error;
        await supabase.rpc("log_admin_action", { p_admin_id: authId, p_action: "disable_admin", p_target_type: "admin", p_target_id: route.id });
        return withCors({ ok: true });
      }

      if (req.method === "POST" && route.action === "enable" && route.id) {
        if (role !== "super_admin") return withCors({ error: "Only super admins can enable team members" }, { status: 403 });
        const { error } = await supabase.from("admin_roles").update({ status: "active" }).eq("id", route.id);
        if (error) throw error;
        return withCors({ ok: true });
      }
    }

    // ── PAYMENT RAILS ──
    if (route.resource === "payment-rails") {
      if (role !== "super_admin" && role !== "finance") {
        return withCors({ error: "Finance or super admin access required" }, { status: 403 });
      }

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
        if (!canWritePayments(role)) return withCors({ error: "Finance or super admin required" }, { status: 403 });
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
      if (role !== "super_admin" && role !== "finance" && role !== "support") {
        return withCors({ error: "Access denied" }, { status: 403 });
      }

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
      ]);

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
      });
    }

    // ── WEBHOOK LOGS ──
    if (route.resource === "webhooks") {
      if (role !== "super_admin" && role !== "finance" && role !== "support") {
        return withCors({ error: "Access denied" }, { status: 403 });
      }

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
        const page = Number(url.searchParams.get("page") ?? 1);
        const limit = Math.min(Number(url.searchParams.get("limit") ?? 50), 100);
        const provider = url.searchParams.get("provider");
        const processed = url.searchParams.get("processed");
        const eventType = url.searchParams.get("event_type");
        const search = url.searchParams.get("search")?.trim();

        let query = supabase
          .from("webhook_logs")
          .select(
            "id, provider, event_type, processed, processing_error, signature_valid, idempotency_key, created_at, processed_at",
            { count: "exact" },
          )
          .order("created_at", { ascending: false })
          .range((page - 1) * limit, page * limit - 1);

        if (provider) query = query.eq("provider", provider);
        if (processed === "true") query = query.eq("processed", true);
        if (processed === "false") query = query.eq("processed", false);
        if (eventType) query = query.ilike("event_type", `%${eventType}%`);
        if (search) {
          query = query.or(`idempotency_key.ilike.%${search}%,event_type.ilike.%${search}%`);
        }

        const { data, count, error } = await query;
        if (error) throw error;

        if (url.searchParams.get("format") === "csv") {
          const csvRows = (data ?? []).map((row: Record<string, unknown>) => ({
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
          );
        }

        return withCors({ webhooks: data, total: count, page, limit });
      }

      if (req.method === "POST" && route.action === "reprocess" && route.id) {
        if (!canWritePayments(role)) return withCors({ error: "Finance or super admin required" }, { status: 403 });

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
      if (role !== "super_admin" && role !== "finance" && role !== "support") {
        return withCors({ error: "Access denied" }, { status: 403 });
      }

      const cutoff = new Date(Date.now() - STUCK_AFTER_MINUTES * 60 * 1000).toISOString();

      const [stuckWithdrawals, unprocessedWebhooks, flaggedTxns] = await Promise.all([
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
      ]);

      const stuckRows = await attachUserFields(supabase, stuckWithdrawals.data ?? []);
      const flaggedRows = await attachUserFields(supabase, flaggedTxns.data ?? []);

      return withCors({
        stuck_withdrawals: stuckRows,
        unprocessed_webhooks: unprocessedWebhooks.data ?? [],
        flagged_transactions: flaggedRows,
      });
    }

    // ── PSP EVENTS ──
    if (route.resource === "psp-events" && req.method === "GET") {
      if (role !== "super_admin" && role !== "finance" && role !== "support") {
        return withCors({ error: "Access denied" }, { status: 403 });
      }

      const url = new URL(req.url);
      const page = Number(url.searchParams.get("page") ?? 1);
      const limit = Math.min(Number(url.searchParams.get("limit") ?? 50), 100);
      const provider = url.searchParams.get("provider");
      const direction = url.searchParams.get("direction");
      const search = url.searchParams.get("search")?.trim();

      let query = supabase
        .from("psp_events")
        .select("*", { count: "exact" })
        .order("created_at", { ascending: false })
        .range((page - 1) * limit, page * limit - 1);

      if (provider) query = query.eq("provider_id", provider);
      if (direction) query = query.eq("direction", direction);
      if (search) {
        query = query.or(`reference.ilike.%${search}%,provider_ref.ilike.%${search}%,event_type.ilike.%${search}%`);
      }

      const { data, count, error } = await query;
      if (error) throw error;

      if (url.searchParams.get("format") === "csv") {
        const csvRows = (data ?? []).map((row: Record<string, unknown>) => ({
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
        );
      }

      return withCors({ events: data, total: count, page, limit });
    }

    // ── AUDIT LOG ──
    if (route.resource === "audit" && req.method === "GET") {
      const url = new URL(req.url);
      const page = Number(url.searchParams.get("page") ?? 1);
      const limit = Math.min(Number(url.searchParams.get("limit") ?? 50), 100);

      const { data, count, error } = await supabase
        .from("admin_audit_log")
        .select("*", { count: "exact" })
        .order("created_at", { ascending: false })
        .range((page - 1) * limit, page * limit - 1);

      if (error) throw error;
      return withCors({ logs: data, total: count, page, limit });
    }

    return withCors({ error: "Not found" }, { status: 404 });
  } catch (err) {
    const detail = err instanceof Error
      ? err.message
      : typeof err === "object" && err && "message" in err
      ? String((err as { message: unknown }).message)
      : String(err);
    return withCors({ error: "Admin API error", detail }, { status: 500 });
  }
});
