import { corsHeaders, withCors } from "../_shared/cors.ts";
import { getAuthedClient, getServiceClient } from "../_shared/db.ts";

Deno.serve(async (req) => {
  if (req.method === "OPTIONS") return new Response("ok", { headers: corsHeaders });

  const authHeader = req.headers.get("Authorization");
  if (!authHeader) return withCors({ error: "Missing authorization" }, { status: 401 });

  const authedClient = getAuthedClient(authHeader);
  const { data: authData, error: authError } = await authedClient.auth.getUser();
  if (authError || !authData.user) return withCors({ error: "Unauthorized" }, { status: 401 });

  const supabase = getServiceClient();
  const { data: user } = await supabase
    .from("users")
    .select("id")
    .eq("auth_id", authData.user.id)
    .single();

  if (!user) return withCors({ error: "User not found" }, { status: 404 });

  // GET — list notifications (latest 50, with unread count)
  if (req.method === "GET") {
    const url = new URL(req.url);
    const unreadOnly = url.searchParams.get("unread") === "true";
    const limit = Math.min(Number(url.searchParams.get("limit") ?? 50), 100);

    let query = supabase
      .from("notifications")
      .select("*")
      .eq("user_id", user.id)
      .order("created_at", { ascending: false })
      .limit(limit);

    if (unreadOnly) query = query.eq("read", false);

    const { data: notifications, error } = await query;
    if (error) return withCors({ error: error.message }, { status: 500 });

    const { count } = await supabase
      .from("notifications")
      .select("id", { count: "exact", head: true })
      .eq("user_id", user.id)
      .eq("read", false);

    return withCors({ notifications, unread_count: count ?? 0 });
  }

  // POST — mark as read (single or all)
  if (req.method === "POST") {
    const body = await req.json();
    const notificationId = body.notification_id as string | undefined;
    const markAll = body.mark_all_read as boolean | undefined;

    if (markAll) {
      const { error } = await supabase
        .from("notifications")
        .update({ read: true, read_at: new Date().toISOString() })
        .eq("user_id", user.id)
        .eq("read", false);

      if (error) return withCors({ error: error.message }, { status: 500 });
      return withCors({ ok: true, marked: "all" });
    }

    if (notificationId) {
      const { error } = await supabase
        .from("notifications")
        .update({ read: true, read_at: new Date().toISOString() })
        .eq("id", notificationId)
        .eq("user_id", user.id);

      if (error) return withCors({ error: error.message }, { status: 500 });
      return withCors({ ok: true, marked: notificationId });
    }

    return withCors({ error: "Provide notification_id or mark_all_read" }, { status: 400 });
  }

  return withCors({ error: "Method not allowed" }, { status: 405 });
});
