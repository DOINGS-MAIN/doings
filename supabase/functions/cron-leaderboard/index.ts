import { withCors } from "../_shared/cors.ts";
import { getServiceClient } from "../_shared/db.ts";

const CRON_SECRET = Deno.env.get("CRON_SECRET") ?? "";

Deno.serve(async (req) => {
  if (req.method !== "POST") return withCors({ error: "Method not allowed" }, { status: 405 });

  const authHeader = req.headers.get("Authorization");
  if (!CRON_SECRET || authHeader !== `Bearer ${CRON_SECRET}`) {
    return withCors({ error: "Unauthorized" }, { status: 401 });
  }

  const supabase = getServiceClient();
  const { error } = await supabase.rpc("refresh_leaderboards");

  if (error) {
    return withCors({ error: "Leaderboard refresh failed", detail: error.message }, { status: 500 });
  }

  return withCors({ ok: true, refreshed_at: new Date().toISOString() });
});
