import type { SupabaseClient } from "https://esm.sh/@supabase/supabase-js@2.49.8";

/**
 * True when an automatic rate was refused in the last 5 minutes (update_fx_market_rate's sanity band,
 * migration 107). A refusal leaves the stored rate stale on purpose, so without this every request
 * would fetch the market again; asking once per 5 minutes is the same pace as a normal refresh.
 */
export async function rateRecentlyRefused(supabase: SupabaseClient): Promise<boolean> {
  const since = new Date(Date.now() - 5 * 60 * 1000).toISOString();
  const { data } = await supabase
    .from("fx_rate_snapshots")
    .select("id")
    .like("source", "%:rejected")
    .gte("created_at", since)
    .limit(1);
  return Boolean(data?.length);
}
