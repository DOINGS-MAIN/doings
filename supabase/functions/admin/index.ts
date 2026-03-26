import { corsHeaders, withCors } from "../_shared/cors.ts";
import { getAuthedClient, getServiceClient } from "../_shared/db.ts";

type RouteAction =
  | { resource: "stats" }
  | { resource: "users"; action?: string; id?: string }
  | { resource: "transactions"; action?: string; id?: string }
  | { resource: "kyc"; action?: string; id?: string }
  | { resource: "events"; action?: string; id?: string }
  | { resource: "team"; action?: string; id?: string }
  | { resource: "audit" }
  | { resource: "unknown" };

function parseRoute(url: string): RouteAction {
  const u = new URL(url);
  const parts = u.pathname.split("/").filter(Boolean);
  const fnIdx = parts.indexOf("admin");
  const rest = parts.slice(fnIdx + 1);

  if (!rest.length || rest[0] === "stats") return { resource: "stats" };
  const resource = rest[0];
  const id = rest[1] && !["suspend", "unsuspend", "ban", "flag", "unflag", "approve", "reject", "end", "invite", "disable", "enable"].includes(rest[1]) ? rest[1] : undefined;
  const action = id ? rest[2] : rest[1];

  if (["users", "transactions", "kyc", "events", "team", "audit"].includes(resource)) {
    return { resource: resource as RouteAction["resource"], action, id } as RouteAction;
  }
  return { resource: "unknown" };
}

async function requireAdmin(req: Request) {
  const authHeader = req.headers.get("Authorization");
  if (!authHeader) throw { status: 401, message: "Missing authorization" };

  const authedClient = getAuthedClient(authHeader);
  const { data: authData, error } = await authedClient.auth.getUser();
  if (error || !authData.user) throw { status: 401, message: "Unauthorized" };

  const supabase = getServiceClient();
  const { data: adminRole } = await supabase
    .from("admin_roles")
    .select("role, status")
    .eq("user_id", authData.user.id)
    .eq("status", "active")
    .maybeSingle();

  if (!adminRole) throw { status: 403, message: "Not an admin" };

  return { authId: authData.user.id, role: adminRole.role as string, supabase };
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
      const [users, txns, events, kyc] = await Promise.all([
        supabase.from("users").select("id, status", { count: "exact", head: false }),
        supabase.from("transactions").select("id, amount, status, created_at", { count: "exact", head: false })
          .eq("status", "completed").gt("amount", 0),
        supabase.from("events").select("id, status", { count: "exact", head: false }),
        supabase.from("kyc_verifications").select("id", { count: "exact", head: true }).eq("status", "pending"),
      ]);

      const today = new Date();
      today.setUTCHours(0, 0, 0, 0);
      const todayTxns = (txns.data ?? []).filter((t: { created_at: string }) => new Date(t.created_at) >= today);

      return withCors({
        totalUsers: users.count ?? 0,
        activeUsers: (users.data ?? []).filter((u: { status: string }) => u.status === "active").length,
        suspendedUsers: (users.data ?? []).filter((u: { status: string }) => u.status === "suspended" || u.status === "banned").length,
        pendingKYC: kyc.count ?? 0,
        totalTransactions: txns.count ?? 0,
        totalVolume: (txns.data ?? []).reduce((s: number, t: { amount: number }) => s + Math.abs(t.amount), 0),
        todayVolume: todayTxns.reduce((s: number, t: { amount: number }) => s + Math.abs(t.amount), 0),
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

        let query = supabase
          .from("transactions")
          .select("id, wallet_id, user_id, currency, type, amount, fee, net_amount, status, provider, provider_ref, idempotency_key, description, metadata, created_at, completed_at", { count: "exact" })
          .order("created_at", { ascending: false })
          .range((page - 1) * limit, page * limit - 1);

        if (status) query = query.eq("status", status);
        if (type) query = query.eq("type", type);
        if (userId) query = query.eq("user_id", userId);

        const { data, count, error } = await query;
        if (error) throw error;
        return withCors({ transactions: data, total: count, page, limit });
      }

      if (req.method === "GET" && route.id) {
        const { data, error } = await supabase
          .from("transactions")
          .select("*, ledger_entries(*)")
          .eq("id", route.id)
          .single();
        if (error) throw error;
        return withCors(data);
      }

      if (req.method === "POST" && route.action === "flag" && route.id) {
        const body = await req.json();
        const { error } = await supabase
          .from("transactions")
          .update({ metadata: supabase.rpc ? undefined : undefined })
          .eq("id", route.id);

        const { data: txn } = await supabase.from("transactions").select("metadata").eq("id", route.id).single();
        const meta = (txn?.metadata as Record<string, unknown>) ?? {};
        meta.flagged = true;
        meta.flag_reason = body.reason;
        meta.flagged_by = authId;
        meta.flagged_at = new Date().toISOString();
        await supabase.from("transactions").update({ metadata: meta }).eq("id", route.id);
        if (error) throw error;

        await supabase.rpc("log_admin_action", { p_admin_id: authId, p_action: "flag_transaction", p_target_type: "transaction", p_target_id: route.id, p_details: { reason: body.reason } });
        return withCors({ ok: true });
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
    return withCors({ error: "Admin API error", detail: String(err) }, { status: 500 });
  }
});
