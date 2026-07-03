import { corsHeaders, withCors } from "../_shared/cors.ts";
import { getAuthUserIdFromRequest, getServiceClient } from "../_shared/db.ts";
import { getPlatformPaymentSettings } from "../_shared/psp/platformSettings.ts";
import { listBanks } from "../_shared/psp/registry.ts";

Deno.serve(async (req) => {
  if (req.method === "OPTIONS") return new Response("ok", { headers: corsHeaders });
  if (req.method !== "GET") return withCors({ error: "Method not allowed" }, { status: 405 });

  const authHeader = req.headers.get("Authorization");
  if (!authHeader) return withCors({ error: "Missing authorization" }, { status: 401 });

  const authUserId = await getAuthUserIdFromRequest(authHeader);
  if (!authUserId) return withCors({ error: "Unauthorized" }, { status: 401 });

  const supabase = getServiceClient();
  let platform;
  try {
    platform = await getPlatformPaymentSettings(supabase);
  } catch {
    return withCors({ error: "Payment provider not configured" }, { status: 500 });
  }

  try {
    const banks = await listBanks(platform.disbursementProviderId, platform.pspEnv);
    return withCors({
      ok: true,
      provider: platform.disbursementProviderId,
      banks,
    });
  } catch (err) {
    return withCors(
      { error: "Failed to load banks", detail: err instanceof Error ? err.message : String(err) },
      { status: 502 },
    );
  }
});
