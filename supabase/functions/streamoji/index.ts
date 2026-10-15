import { corsHeaders, withCors } from "../_shared/cors.ts";
import { getAuthUserIdFromRequest, getServiceClient } from "../_shared/db.ts";

const AUTH_URL = "https://us-central1-streamoji-265f4.cloudfunctions.net/getAuthToken";
const BUCKET = "avatars";

function credentials() {
  const clientId = Deno.env.get("STREAMOJI_CLIENT_ID")?.trim();
  const clientSecret = Deno.env.get("STREAMOJI_CLIENT_SECRET")?.trim();
  if (!clientId || !clientSecret) return null;
  return { clientId, clientSecret };
}

async function authToken(userId: string, userName: string): Promise<string> {
  const creds = credentials();
  if (!creds) throw new Error("Streamoji is not configured");
  const res = await fetch(AUTH_URL, {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      "Client-Id": creds.clientId,
      "Client-Secret": creds.clientSecret,
    },
    body: JSON.stringify({ userId, userName, maxAvatarsCreations: 20 }),
  });
  const json = await res.json().catch(() => ({}));
  if (!res.ok || json.success === false || typeof json.authToken !== "string") {
    const detail = typeof json.error === "string" ? json.error : "Streamoji login failed";
    throw new Error(detail);
  }
  return json.authToken;
}

async function mergeAvatarData(
  authUserId: string,
  model3d: Record<string, unknown>,
  photoUrl?: string | null,
) {
  const supabase = getServiceClient();
  const { data: row, error } = await supabase
    .from("users")
    .select("avatar_data")
    .eq("auth_id", authUserId)
    .maybeSingle();
  if (error) throw new Error(error.message);
  const current = row?.avatar_data && typeof row.avatar_data === "object" ? row.avatar_data : {};
  const next = { ...current, model3d, ...(photoUrl ? { photoUrl } : {}) };
  const { error: updateError } = await supabase
    .from("users")
    .update({
      avatar_data: next,
      ...(photoUrl ? { avatar_url: photoUrl } : {}),
    })
    .eq("auth_id", authUserId);
  if (updateError) throw new Error(updateError.message);
}

function isImage(bytes: Uint8Array, contentType: string): boolean {
  if (bytes.byteLength < 32) return false;
  if (contentType.startsWith("image/")) return true;
  const png = bytes[0] === 0x89 && bytes[1] === 0x50 && bytes[2] === 0x4e && bytes[3] === 0x47;
  const jpeg = bytes[0] === 0xff && bytes[1] === 0xd8;
  const webp = bytes[0] === 0x52 && bytes[1] === 0x49 && bytes[2] === 0x46 && bytes[3] === 0x46;
  return png || jpeg || webp;
}

async function readImage(res: Response): Promise<Uint8Array | null> {
  const type = res.headers.get("content-type") ?? "";
  if (type.includes("json")) {
    const json = await res.json().catch(() => null);
    const nested = json?.url ?? json?.data?.url ?? json?.thumbnailUrl ?? json?.data?.thumbnailUrl;
    if (typeof nested !== "string" || !nested.startsWith("https://")) return null;
    const follow = await fetch(nested).catch(() => null);
    return follow?.ok ? readImage(follow) : null;
  }
  const bytes = new Uint8Array(await res.arrayBuffer());
  return isImage(bytes, type) ? bytes : null;
}

async function fetchThumbnail(token: string, avatarId: string, previewUrl?: string): Promise<Uint8Array | null> {
  const id = encodeURIComponent(avatarId);
  const encodedToken = encodeURIComponent(token);
  const bearer = { Authorization: `Bearer ${token}` };
  const candidates: Array<{ url: string; init: RequestInit }> = [];
  if (previewUrl?.startsWith("https://")) candidates.push({ url: previewUrl, init: { method: "GET" } });
  candidates.push(
    { url: `https://glb.streamoji.com/api/render-thumbnail?avatarId=${id}`, init: { method: "POST", headers: bearer } },
    { url: `https://glb.streamoji.com/api/avatars/${id}.png?token=${encodedToken}`, init: { method: "GET" } },
    { url: `https://glb.streamoji.com/api/render-thumbnail?avatarId=${id}&token=${encodedToken}`, init: { method: "GET" } },
  );

  for (const candidate of candidates) {
    const res = await fetch(candidate.url, candidate.init).catch(() => null);
    if (!res?.ok) continue;
    const bytes = await readImage(res);
    if (bytes) return bytes;
  }
  return null;
}

Deno.serve(async (req) => {
  if (req.method === "OPTIONS") return new Response("ok", { headers: corsHeaders });

  try {
    if (req.method !== "POST") return withCors({ error: "Method not allowed" }, { status: 405 });
    const authUserId = await getAuthUserIdFromRequest(req.headers.get("Authorization"));
    if (!authUserId) return withCors({ error: "Unauthorized" }, { status: 401 });
    if (!credentials()) {
      return withCors(
        {
          error: "Streamoji is not configured",
          code: "streamoji_not_configured",
          detail: "Set STREAMOJI_CLIENT_ID and STREAMOJI_CLIENT_SECRET on the streamoji edge function.",
        },
        { status: 503 },
      );
    }

    const body = (await req.json().catch(() => null)) as Record<string, unknown> | null;
    const action = body?.action;
    const userName = typeof body?.userName === "string" && body.userName.trim() ? body.userName.trim().slice(0, 80) : "Doings user";

    if (action === "session") {
      const token = await authToken(authUserId, userName);
      return withCors({ ok: true, authToken: token });
    }

    if (action === "saved") {
      const token = await authToken(authUserId, userName);
      const res = await fetch("https://us-central1-streamoji-265f4.cloudfunctions.net/getSavedAvatarsForUser", {
        headers: { Authorization: `Bearer ${token}`, "Content-Type": "application/json" },
      });
      const json = await res.json().catch(() => ({}));
      const raw = json?.data?.avatarIds ?? json?.data ?? [];
      const avatarIds = Array.isArray(raw)
        ? raw.map((item) => (typeof item === "string" ? item : item?.avatarId ?? item?.id)).filter((id) => typeof id === "string")
        : [];
      return withCors({ ok: true, avatarIds });
    }

    if (action === "store") {
      const avatarId = typeof body?.avatarId === "string" ? body.avatarId.trim() : "";
      if (!/^[A-Za-z0-9_-]{4,128}$/.test(avatarId)) {
        return withCors({ error: "Missing Streamoji avatar id" }, { status: 400 });
      }
      const token = await authToken(authUserId, userName);
      const glbRes = await fetch(`https://glb.streamoji.com/api/avatars/${avatarId}.glb?token=${encodeURIComponent(token)}`);
      if (!glbRes.ok) {
        return withCors({ error: `Could not download avatar (${glbRes.status})` }, { status: 502 });
      }
      const bytes = new Uint8Array(await glbRes.arrayBuffer());
      if (bytes.byteLength < 32) return withCors({ error: "Streamoji returned an empty model" }, { status: 502 });

      const supabase = getServiceClient();
      const path = `${authUserId}/streamoji.glb`;
      const { error: uploadError } = await supabase.storage.from(BUCKET).upload(path, bytes, {
        upsert: true,
        contentType: "model/gltf-binary",
        cacheControl: "3600",
      });
      if (uploadError) return withCors({ error: uploadError.message }, { status: 500 });
      const version = Date.now();
      const modelUrl = `${supabase.storage.from(BUCKET).getPublicUrl(path).data.publicUrl}?v=${version}`;
      const previewUrl = typeof body?.previewUrl === "string" ? body.previewUrl : undefined;
      const thumbBytes = await fetchThumbnail(token, avatarId, previewUrl);
      let thumbnailUrl: string | null = null;
      if (thumbBytes) {
        const thumbPath = `${authUserId}/streamoji-thumb.png`;
        const { error: thumbError } = await supabase.storage.from(BUCKET).upload(thumbPath, thumbBytes, {
          upsert: true,
          contentType: "image/png",
          cacheControl: "60",
        });
        if (!thumbError) {
          thumbnailUrl = `${supabase.storage.from(BUCKET).getPublicUrl(thumbPath).data.publicUrl}?v=${version}`;
        }
      }
      const model3d = {
        provider: "streamoji",
        avatarId,
        status: "completed",
        progress: 100,
        modelUrl,
        thumbnailUrl,
        playerUid: null,
        avatarCode: null,
        subtype: null,
      };
      await mergeAvatarData(authUserId, model3d, thumbnailUrl);
      return withCors({ ok: true, model3d, photoUrl: thumbnailUrl });
    }

    return withCors({ error: "Unknown action" }, { status: 400 });
  } catch (err) {
    const message = err instanceof Error ? err.message : "Streamoji request failed";
    const status = message === "Streamoji is not configured" ? 503 : 500;
    return withCors({ error: message, code: status === 503 ? "streamoji_not_configured" : "streamoji_failed" }, { status });
  }
});
