import { createClient } from "npm:@supabase/supabase-js@2";

const supabaseUrl = Deno.env.get("SUPABASE_URL") ?? "";
const serviceRoleKey = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY") ?? "";
const anonKey = Deno.env.get("SUPABASE_ANON_KEY") ?? "";

/**
 * Resolves the signed-in user id (`auth.users.id`) using GoTrue’s HTTP API.
 * Supabase access tokens are often ES256; `createClient(...).auth.getUser()` in Edge
 * can throw “Unsupported JWT algorithm ES256”. This path always works.
 */
export async function getAuthUserIdFromRequest(authHeader: string | null): Promise<string | null> {
  if (!authHeader || !supabaseUrl || !anonKey) return null;
  const authorization = /^Bearer\s+/i.test(authHeader) ? authHeader : `Bearer ${authHeader}`;
  const res = await fetch(`${supabaseUrl}/auth/v1/user`, {
    headers: {
      Authorization: authorization,
      apikey: anonKey,
    },
  });
  if (!res.ok) return null;
  try {
    const body = (await res.json()) as { id?: string };
    return typeof body.id === "string" ? body.id : null;
  } catch {
    return null;
  }
}

export function getServiceClient() {
  if (!supabaseUrl || !serviceRoleKey) {
    throw new Error("Missing SUPABASE_URL or SUPABASE_SERVICE_ROLE_KEY");
  }
  return createClient(supabaseUrl, serviceRoleKey, {
    auth: { persistSession: false, autoRefreshToken: false },
  });
}

export function getAuthedClient(authHeader: string) {
  if (!supabaseUrl || !anonKey) {
    throw new Error("Missing SUPABASE_URL or SUPABASE_ANON_KEY");
  }
  return createClient(supabaseUrl, anonKey, {
    global: {
      headers: { Authorization: authHeader },
    },
    auth: { persistSession: false, autoRefreshToken: false },
  });
}

/** Ensures `public.users` exists for the JWT bearer and returns `users.id`. */
export async function resolveAppUserId(authHeader: string): Promise<string | null> {
  const authorization = /^Bearer\s+/i.test(authHeader) ? authHeader : `Bearer ${authHeader}`;
  const client = getAuthedClient(authorization);
  const { data, error } = await client.rpc("ensure_auth_user_profile");
  if (error) {
    console.error("resolveAppUserId:", error.message);
    return null;
  }
  return typeof data === "string" ? data : null;
}
