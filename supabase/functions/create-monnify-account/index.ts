import { corsHeaders, withCors } from "../_shared/cors.ts";
import { getAuthedClient, getServiceClient } from "../_shared/db.ts";
import { createReservedAccount } from "../_shared/monnify.ts";

Deno.serve(async (req) => {
  if (req.method === "OPTIONS") return new Response("ok", { headers: corsHeaders });
  if (req.method !== "POST") return withCors({ error: "Method not allowed" }, { status: 405 });

  const authHeader = req.headers.get("Authorization");
  if (!authHeader) return withCors({ error: "Missing authorization" }, { status: 401 });

  const authedClient = getAuthedClient(authHeader);
  const { data: authData, error: authError } = await authedClient.auth.getUser();
  if (authError || !authData.user) return withCors({ error: "Unauthorized" }, { status: 401 });

  const supabase = getServiceClient();
  const { data: user, error: userErr } = await supabase
    .from("users")
    .select("id, full_name, email, kyc_level")
    .eq("auth_id", authData.user.id)
    .single();

  if (userErr || !user) return withCors({ error: "User not found" }, { status: 404 });
  if (user.kyc_level < 2) return withCors({ error: "KYC level 2 required" }, { status: 403 });

  const { data: existing } = await supabase
    .from("monnify_reserved_accounts")
    .select("id, account_number, bank_name")
    .eq("user_id", user.id)
    .limit(1)
    .maybeSingle();

  if (existing) {
    return withCors({ ok: true, already_exists: true, account: existing });
  }

  try {
    const body = await req.json().catch(() => ({})) as { bvn?: string };
    if (!body.bvn || body.bvn.replace(/\D/g, "").length !== 11) {
      return withCors({ error: "Valid 11-digit BVN is required" }, { status: 400 });
    }

    const { data: ngnWallet } = await supabase
      .from("wallets")
      .select("id")
      .eq("user_id", user.id)
      .eq("currency", "NGN")
      .single();

    if (!ngnWallet) return withCors({ error: "NGN wallet not found" }, { status: 500 });

    const acct = await createReservedAccount({
      userId: user.id,
      userName: user.full_name || "Doings User",
      email: user.email || "",
      bvn: body.bvn.replace(/\D/g, ""),
    });

    const { error: insertErr } = await supabase
      .from("monnify_reserved_accounts")
      .insert({
        user_id: user.id,
        wallet_id: ngnWallet.id,
        account_reference: acct.accountReference,
        account_name: acct.accountName,
        account_number: acct.accountNumber,
        bank_name: acct.bankName,
        bank_code: acct.bankCode,
        reservation_reference: acct.reservationReference,
      });

    if (insertErr) throw insertErr;

    return withCors({ ok: true, account: acct });
  } catch (error) {
    return withCors({ error: "Failed to create reserved account", detail: String(error) }, { status: 500 });
  }
});
