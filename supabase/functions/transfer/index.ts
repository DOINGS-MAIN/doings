import { corsHeaders, withCors } from "../_shared/cors.ts";
import { getAuthedClient, getServiceClient } from "../_shared/db.ts";
import { checkTransferLimit } from "../_shared/limits.ts";
import { checkRateLimit, RATE_LIMITS } from "../_shared/rate-limit.ts";

type TransferBody = {
  recipient_phone: string;
  amount: number;
  currency?: "NGN" | "USDT";
  description?: string;
};

Deno.serve(async (req) => {
  if (req.method === "OPTIONS") return new Response("ok", { headers: corsHeaders });
  if (req.method !== "POST") return withCors({ error: "Method not allowed" }, { status: 405 });

  const authHeader = req.headers.get("Authorization");
  if (!authHeader) return withCors({ error: "Missing authorization" }, { status: 401 });

  const authedClient = getAuthedClient(authHeader);
  const { data: authData, error: authError } = await authedClient.auth.getUser();
  if (authError || !authData.user) return withCors({ error: "Unauthorized" }, { status: 401 });

  const supabase = getServiceClient();
  const { data: sender, error: senderErr } = await supabase
    .from("users")
    .select("id, kyc_level")
    .eq("auth_id", authData.user.id)
    .single();

  if (senderErr || !sender) return withCors({ error: "User not found" }, { status: 404 });
  if (sender.kyc_level < 1) return withCors({ error: "KYC level 1 required for transfers" }, { status: 403 });

  const rl = await checkRateLimit(RATE_LIMITS.transfer(sender.id));
  if (!rl.allowed) return withCors({ error: "Too many transfer requests. Try again shortly." }, { status: 429 });

  const body = (await req.json()) as TransferBody;
  if (!body.recipient_phone || !body.amount) {
    return withCors({ error: "recipient_phone and amount are required" }, { status: 400 });
  }

  const currency = body.currency ?? "NGN";
  if (currency !== "NGN" && currency !== "USDT") {
    return withCors({ error: "currency must be NGN or USDT" }, { status: 400 });
  }

  const smallestUnit = currency === "NGN"
    ? Math.round(body.amount * 100)
    : Math.round(body.amount * 1_000_000);

  if (smallestUnit <= 0) return withCors({ error: "amount must be positive" }, { status: 400 });

  const { allowed, reason } = await checkTransferLimit(sender.id, sender.kyc_level, currency, smallestUnit);
  if (!allowed) return withCors({ error: reason }, { status: 403 });

  const normalizedPhone = body.recipient_phone.replace(/\s+/g, "");

  const { data: recipient, error: recipientErr } = await supabase
    .from("users")
    .select("id")
    .eq("phone", normalizedPhone)
    .single();

  if (recipientErr || !recipient) {
    return withCors({ error: "Recipient not found. They must have a Doings account." }, { status: 404 });
  }

  if (recipient.id === sender.id) {
    return withCors({ error: "Cannot transfer to yourself" }, { status: 400 });
  }

  const { data: senderWallet } = await supabase
    .from("wallets")
    .select("id")
    .eq("user_id", sender.id)
    .eq("currency", currency)
    .single();

  const { data: recipientWallet } = await supabase
    .from("wallets")
    .select("id")
    .eq("user_id", recipient.id)
    .eq("currency", currency)
    .single();

  if (!senderWallet || !recipientWallet) {
    return withCors({ error: `${currency} wallet not found` }, { status: 500 });
  }

  try {
    const { data: transferId, error: transferErr } = await supabase.rpc("internal_transfer", {
      p_sender_wallet_id: senderWallet.id,
      p_receiver_wallet_id: recipientWallet.id,
      p_sender_user_id: sender.id,
      p_receiver_user_id: recipient.id,
      p_amount: smallestUnit,
      p_fee: 0,
      p_description: body.description ?? `Transfer to ${normalizedPhone}`,
      p_type: "transfer",
    });

    if (transferErr) throw transferErr;

    return withCors({
      ok: true,
      transfer_id: transferId,
      currency,
      amount: body.amount,
      recipient_phone: normalizedPhone,
    });
  } catch (err) {
    const msg = String(err);
    if (msg.includes("Insufficient")) {
      return withCors({ error: "Insufficient balance" }, { status: 400 });
    }
    return withCors({ error: "Transfer failed", detail: msg }, { status: 500 });
  }
});
