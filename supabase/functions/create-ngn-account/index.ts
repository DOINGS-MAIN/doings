import { corsHeaders, withCors } from "../_shared/cors.ts";
import { getAuthUserIdFromRequest, getServiceClient } from "../_shared/db.ts";
import { getPlatformPaymentSettings } from "../_shared/psp/platformSettings.ts";
import {
  getExistingReservedAccount,
  provisionReservedAccount,
} from "../_shared/psp/provisionReservedAccount.ts";

Deno.serve(async (req) => {
  if (req.method === "OPTIONS") return new Response("ok", { headers: corsHeaders });
  if (req.method !== "POST") return withCors({ error: "Method not allowed" }, { status: 405 });

  const authHeader = req.headers.get("Authorization");
  if (!authHeader) return withCors({ error: "Missing authorization" }, { status: 401 });

  const authUserId = await getAuthUserIdFromRequest(authHeader);
  if (!authUserId) return withCors({ error: "Unauthorized" }, { status: 401 });

  const supabase = getServiceClient();
  const { data: user, error: userErr } = await supabase
    .from("users")
    .select("id, full_name, email, kyc_level")
    .eq("auth_id", authUserId)
    .single();

  if (userErr || !user) return withCors({ error: "User not found" }, { status: 404 });
  if (user.kyc_level < 2) return withCors({ error: "KYC level 2 required" }, { status: 403 });

  const platform = await getPlatformPaymentSettings(supabase);
  const providerId = platform.walletFundingProviderId;

  const existing = await getExistingReservedAccount(supabase, user.id, providerId);
  if (existing) {
    return withCors({ ok: true, already_exists: true, provider: providerId, account: existing });
  }

  try {
    const body = await req.json().catch(() => ({})) as { bvn?: string; nin?: string };

    const { data: ngnWallet } = await supabase
      .from("wallets")
      .select("id")
      .eq("user_id", user.id)
      .eq("currency", "NGN")
      .single();

    if (!ngnWallet) return withCors({ error: "NGN wallet not found" }, { status: 500 });

    const account = await provisionReservedAccount(supabase, {
      userId: user.id,
      userName: user.full_name || "Doings User",
      email: user.email || "",
      walletId: ngnWallet.id,
      bvn: body.bvn,
      nin: body.nin,
      providerId,
    });

    return withCors({ ok: true, provider: providerId, account });
  } catch (error) {
    return withCors({ error: "Failed to create funding account", detail: String(error) }, { status: 500 });
  }
});
