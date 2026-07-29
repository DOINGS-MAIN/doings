import type { Session } from "@supabase/supabase-js";
import { supabase } from "@/lib/supabase";

/** Coalesce concurrent `getSession()` calls — parallel callers share one in-flight request. */
let cachedSession: Session | null | undefined;
let inflightSession: Promise<Session | null> | null = null;

export function invalidateAuthSessionCache(): void {
  cachedSession = undefined;
  inflightSession = null;
}

export async function getCachedSession(): Promise<Session | null> {
  ensureAuthSessionCacheInvalidation();
  if (cachedSession !== undefined) return cachedSession;
  if (inflightSession) return inflightSession;

  inflightSession = supabase.auth
    .getSession()
    .then(({ data: { session } }) => {
      cachedSession = session;
      inflightSession = null;
      return session;
    })
    .catch((err) => {
      inflightSession = null;
      throw err;
    });

  return inflightSession;
}

let cacheInvalidationRegistered = false;

export function ensureAuthSessionCacheInvalidation(): void {
  if (cacheInvalidationRegistered) return;
  cacheInvalidationRegistered = true;
  supabase.auth.onAuthStateChange(() => {
    invalidateAuthSessionCache();
  });
}

