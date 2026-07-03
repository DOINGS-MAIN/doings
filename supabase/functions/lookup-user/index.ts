import { corsHeaders, withCors } from "../_shared/cors.ts";
import { getAuthUserIdFromRequest, getServiceClient, resolveAppUserId } from "../_shared/db.ts";
import { normalizeUsername, USERNAME_RE } from "../_shared/username.ts";

type UserRow = {
  id: string;
  full_name: string | null;
  username: string | null;
  avatar_url: string | null;
  avatar_data: Record<string, unknown> | null;
  kyc_level: number;
};

function mapRecipient(row: UserRow) {
  const avatarData = row.avatar_data ?? {};
  const emoji = typeof avatarData.emoji === "string" ? avatarData.emoji : null;
  return {
    id: row.id,
    name: row.full_name?.trim() || row.username || "Doings user",
    username: row.username ? `@${row.username}` : "",
    avatar: emoji ?? "👤",
    avatar_url: row.avatar_url,
    kyc_level: row.kyc_level,
  };
}

Deno.serve(async (req) => {
  if (req.method === "OPTIONS") return new Response("ok", { headers: corsHeaders });

  try {
    if (req.method !== "GET") return withCors({ error: "Method not allowed" }, { status: 405 });

    const authHeader = req.headers.get("Authorization");
    if (!authHeader) return withCors({ error: "Missing authorization" }, { status: 401 });

    const authUserId = await getAuthUserIdFromRequest(authHeader);
    if (!authUserId) return withCors({ error: "Unauthorized" }, { status: 401 });

    const senderId = await resolveAppUserId(authHeader);
    if (!senderId) return withCors({ error: "User profile not found" }, { status: 404 });

    const supabase = getServiceClient();
    const url = new URL(req.url);

    if (url.searchParams.get("recent") === "true") {
      const { data: transfers, error } = await supabase
        .from("transfers")
        .select("receiver_user_id, created_at")
        .eq("sender_user_id", senderId)
        .eq("status", "completed")
        .order("created_at", { ascending: false })
        .limit(20);

      if (error) {
        return withCors({ error: "Failed to load recent recipients", detail: error.message }, { status: 500 });
      }

      const orderedReceiverIds: string[] = [];
      const seen = new Set<string>();
      for (const row of transfers ?? []) {
        const receiverId = row.receiver_user_id as string;
        if (!receiverId || receiverId === senderId || seen.has(receiverId)) continue;
        seen.add(receiverId);
        orderedReceiverIds.push(receiverId);
        if (orderedReceiverIds.length >= 8) break;
      }

      if (orderedReceiverIds.length === 0) {
        return withCors({ ok: true, recipients: [] });
      }

      const { data: users, error: usersErr } = await supabase
        .from("users")
        .select("id, full_name, username, avatar_url, avatar_data, kyc_level")
        .in("id", orderedReceiverIds);

      if (usersErr) {
        return withCors({ error: "Failed to load recent recipients", detail: usersErr.message }, { status: 500 });
      }

      const byId = new Map((users ?? []).map((u) => [u.id as string, u as UserRow]));
      const recent = orderedReceiverIds
        .map((id) => byId.get(id))
        .filter((u): u is UserRow => Boolean(u))
        .map(mapRecipient);

      return withCors({ ok: true, recipients: recent });
    }

    const username = normalizeUsername(url.searchParams.get("username") ?? "");
    if (!username || !USERNAME_RE.test(username)) {
      return withCors(
        { error: "Enter a valid username (3–30 characters, letters, numbers, underscore)" },
        { status: 400 },
      );
    }

    const { data: user, error: userErr } = await supabase
      .from("users")
      .select("id, full_name, username, avatar_url, avatar_data, kyc_level, status")
      .eq("username", username)
      .maybeSingle();

    if (userErr) {
      return withCors({ error: "Lookup failed", detail: userErr.message }, { status: 500 });
    }
    if (!user || user.status !== "active") {
      return withCors({ error: "No active user found with that username" }, { status: 404 });
    }

    if (user.id === senderId) {
      return withCors({ error: "You cannot send money to yourself" }, { status: 400 });
    }

    return withCors({ ok: true, user: mapRecipient(user as UserRow) });
  } catch (err) {
    console.error("lookup-user error:", err);
    return withCors(
      { error: "Lookup failed", detail: err instanceof Error ? err.message : String(err) },
      { status: 500 },
    );
  }
});
