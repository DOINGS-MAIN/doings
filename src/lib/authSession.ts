import type { Session } from "@supabase/supabase-js";
import { supabase } from "@/lib/supabase";

/** Coalesce concurrent `getSession()` calls — parallel callers share one in-flight request. */
let cachedSession: Session | null | undefined;
let inflightSession: Promise<Session | null> | null = null;
let inflightRefresh: Promise<Session | null> | null = null;

function isInvalidRefreshTokenError(error: unknown): boolean {
  if (!error || typeof error !== "object") return false;
  const e = error as { message?: string; status?: number };
  const msg = (e.message ?? "").toLowerCase();
  return (
    e.status === 400 ||
    msg.includes("refresh token not found") ||
    msg.includes("invalid refresh token") ||
    msg.includes("refresh_token_not_found")
  );
}

/** Drop expired/revoked refresh tokens from local storage so anon pages keep working. */
async function clearStaleAuthSession(): Promise<null> {
  cachedSession = null;
  inflightSession = null;
  inflightRefresh = null;
  try {
    await supabase.auth.signOut({ scope: "local" });
  } catch {
    /* ignore — storage may already be empty */
  }
  return null;
}

export function invalidateAuthSessionCache(): void {
  cachedSession = undefined;
  inflightSession = null;
  inflightRefresh = null;
}

export async function getCachedSession(): Promise<Session | null> {
  ensureAuthSessionCacheInvalidation();
  if (cachedSession !== undefined) return cachedSession;
  if (inflightSession) return inflightSession;

  inflightSession = supabase.auth
    .getSession()
    .then(({ data: { session }, error }) => {
      inflightSession = null;
      if (error && isInvalidRefreshTokenError(error)) {
        return clearStaleAuthSession();
      }
      cachedSession = session;
      return session;
    })
    .catch((err) => {
      inflightSession = null;
      if (isInvalidRefreshTokenError(err)) {
        return clearStaleAuthSession();
      }
      throw err;
    });

  return inflightSession;
}

/**
 * Returns a session, refreshing once when near expiry.
 * Concurrent refresh callers share one in-flight `refreshSession()` (avoids auth deadlocks).
 */
export async function getValidSession(refreshSkewSec = 600): Promise<Session | null> {
  let session = await getCachedSession();
  if (!session?.refresh_token) return session;

  const nowSec = Math.floor(Date.now() / 1000);
  const exp = session.expires_at ?? 0;
  if (exp > nowSec + refreshSkewSec) return session;

  if (inflightRefresh) return inflightRefresh;

  const previous = session;
  inflightRefresh = supabase.auth
    .refreshSession()
    .then(({ data, error }) => {
      inflightRefresh = null;
      if (!error && data.session) {
        cachedSession = data.session;
        return data.session;
      }
      if (error && isInvalidRefreshTokenError(error)) {
        return clearStaleAuthSession();
      }
      return previous;
    })
    .catch((err) => {
      inflightRefresh = null;
      if (isInvalidRefreshTokenError(err)) {
        return clearStaleAuthSession();
      }
      throw err;
    });

  return inflightRefresh;
}

/**
 * Force-refresh the session once. Concurrent callers share one in-flight request.
 */
export async function refreshCachedSession(): Promise<Session | null> {
  if (inflightRefresh) return inflightRefresh;

  inflightRefresh = supabase.auth
    .refreshSession()
    .then(({ data, error }) => {
      inflightRefresh = null;
      if (!error && data.session) {
        cachedSession = data.session;
        return data.session;
      }
      if (error && isInvalidRefreshTokenError(error)) {
        return clearStaleAuthSession();
      }
      return cachedSession !== undefined ? cachedSession : null;
    })
    .catch((err) => {
      inflightRefresh = null;
      if (isInvalidRefreshTokenError(err)) {
        return clearStaleAuthSession();
      }
      throw err;
    });

  return inflightRefresh;
}

let cacheInvalidationRegistered = false;

export function ensureAuthSessionCacheInvalidation(): void {
  if (cacheInvalidationRegistered) return;
  cacheInvalidationRegistered = true;
  supabase.auth.onAuthStateChange((_event, session) => {
    cachedSession = session;
    inflightSession = null;
    inflightRefresh = null;
  });
}
