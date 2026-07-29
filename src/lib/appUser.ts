import { supabase } from "@/lib/supabase";
import { getCachedSession, invalidateAuthSessionCache } from "@/lib/authSession";

let cachedAppUser: { authId: string; appUserId: string } | null = null;

let appUserInvalidationRegistered = false;

function ensureAppUserCacheInvalidation(): void {
  if (appUserInvalidationRegistered) return;
  appUserInvalidationRegistered = true;
  supabase.auth.onAuthStateChange(() => {
    cachedAppUser = null;
  });
}

/** Resolves `public.users.id` for the current session (`wallets.user_id`, etc.). */
export async function getAppUserId(): Promise<string | null> {
  ensureAppUserCacheInvalidation();
  const session = await getCachedSession();
  const authId = session?.user?.id;
  if (!authId) {
    cachedAppUser = null;
    return null;
  }

  if (cachedAppUser?.authId === authId) {
    return cachedAppUser.appUserId;
  }

  const { data, error } = await supabase
    .from("users")
    .select("id")
    .eq("auth_id", authId)
    .maybeSingle();

  if (error || !data?.id) {
    cachedAppUser = null;
    return null;
  }

  cachedAppUser = { authId, appUserId: data.id as string };
  return cachedAppUser.appUserId;
}

/** Clears the cached `public.users.id` (e.g. after sign-out). */
export function invalidateAppUserCache(): void {
  cachedAppUser = null;
  invalidateAuthSessionCache();
}
