import { supabase } from "@/lib/supabase";

/** Resolves `public.users.id` for the current session (`wallets.user_id`, etc.). */
export async function getAppUserId(): Promise<string | null> {
  const {
    data: { session },
  } = await supabase.auth.getSession();
  if (!session?.user?.id) return null;
  const { data, error } = await supabase
    .from("users")
    .select("id")
    .eq("auth_id", session.user.id)
    .maybeSingle();
  if (error || !data?.id) return null;
  return data.id as string;
}
