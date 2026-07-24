import { corsHeaders, withCors } from "../_shared/cors.ts";
import { getAuthUserIdFromRequest, getServiceClient } from "../_shared/db.ts";
import { generateDepositAddress } from "../_shared/blockradar.ts";
import { toBlockradarNetwork, toStorageNetwork } from "../_shared/blockradarNetwork.ts";

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
    .select("id, kyc_level")
    .eq("auth_id", authUserId)
    .single();

  if (userErr || !user) return withCors({ error: "User not found" }, { status: 404 });
  if (user.kyc_level < 2) return withCors({ error: "KYC level 2 required" }, { status: 403 });

  const body = await req.json().catch(() => ({})) as { network?: string };
  const blockradarNetwork = toBlockradarNetwork(body.network);
  const storageNetwork = toStorageNetwork(body.network);

  const { data: usdcWallet } = await supabase
    .from("wallets")
    .select("id")
    .eq("user_id", user.id)
    .eq("currency", "USDC")
    .single();

  if (!usdcWallet) return withCors({ error: "USDC wallet not found" }, { status: 500 });

  const { data: existing } = await supabase
    .from("wallet_addresses")
    .select("id, address, network")
    .eq("wallet_id", usdcWallet.id)
    .eq("provider", "blockradar")
    .eq("network", storageNetwork)
    .limit(1)
    .maybeSingle();

  if (existing) {
    return withCors({ ok: true, already_exists: true, address: existing.address, network: existing.network });
  }

  try {
    const result = await generateDepositAddress({ userId: user.id, network: blockradarNetwork });

    const { error: insertErr } = await supabase
      .from("wallet_addresses")
      .insert({
        wallet_id: usdcWallet.id,
        provider: "blockradar",
        address: result.address,
        network: storageNetwork,
        label: `DOINGS-${user.id}`,
      });

    if (insertErr) throw insertErr;

    return withCors({ ok: true, address: result.address, network: storageNetwork });
  } catch (error) {
    return withCors({ error: "Failed to generate address", detail: String(error) }, { status: 500 });
  }
});
