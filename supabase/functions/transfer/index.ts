import { corsHeaders, withCors } from "../_shared/cors.ts";
import { getAuthUserIdFromRequest, getServiceClient, resolveAppUserId } from "../_shared/db.ts";
import { checkTransferLimit } from "../_shared/limits.ts";
import { checkRateLimit, RATE_LIMITS } from "../_shared/rate-limit.ts";
import { requireTransactionPin } from "../_shared/pin.ts";
import { normalizeUsername, USERNAME_RE } from "../_shared/username.ts";

/** In-app P2P sends are always fee-free — never apply withdrawal/platform fees here. */
const P2P_TRANSFER_FEE = 0;

type TransferBody = {
  recipient_username: string;
  amount: number;
  currency?: "NGN" | "USDC";
  description?: string;
  pin: string;
};

Deno.serve(async (req) => {
  if (req.method === "OPTIONS") return new Response("ok", { headers: corsHeaders });
  if (req.method !== "POST") return withCors({ error: "Method not allowed" }, { status: 405 });

  const authHeader = req.headers.get("Authorization");
  if (!authHeader) return withCors({ error: "Missing authorization" }, { status: 401 });

  const authUserId = await getAuthUserIdFromRequest(authHeader);
  if (!authUserId) return withCors({ error: "Unauthorized" }, { status: 401 });

  const supabase = getServiceClient();
  const senderId = await resolveAppUserId(authHeader);
  if (!senderId) return withCors({ error: "User not found" }, { status: 404 });

  const { data: sender, error: senderErr } = await supabase
    .from("users")
    .select("id, kyc_level")
    .eq("id", senderId)
    .single();

  if (senderErr || !sender) return withCors({ error: "User not found" }, { status: 404 });
  if (sender.kyc_level < 2) return withCors({ error: "Complete BVN and NIN verification to send money" }, { status: 403 });

  const body = (await req.json()) as TransferBody;
  const pinCheck = await requireTransactionPin(supabase, sender.id, body.pin);
  if (pinCheck) return pinCheck;

  const rl = await checkRateLimit(RATE_LIMITS.transfer(sender.id));
  if (!rl.allowed) return withCors({ error: "Too many transfer requests. Try again shortly." }, { status: 429 });

  if (!body.recipient_username || body.amount == null) {
    return withCors({ error: "recipient_username and amount are required" }, { status: 400 });
  }

  const recipientUsername = normalizeUsername(body.recipient_username);
  if (!USERNAME_RE.test(recipientUsername)) {
    return withCors({ error: "Invalid recipient username" }, { status: 400 });
  }

  const currency = body.currency ?? "NGN";
  if (currency !== "NGN" && currency !== "USDC") {
    return withCors({ error: "currency must be NGN or USDC" }, { status: 400 });
  }

  /** Amount in major units (naira or USDC); converted to smallest unit server-side. */
  const smallestUnit = currency === "NGN"
    ? Math.round(body.amount * 100)
    : Math.round(body.amount * 1_000_000);

  if (smallestUnit <= 0) return withCors({ error: "amount must be positive" }, { status: 400 });

  const { allowed, reason } = await checkTransferLimit(sender.id, sender.kyc_level, currency, smallestUnit);
  if (!allowed) return withCors({ error: reason }, { status: 403 });

  const { data: recipient, error: recipientErr } = await supabase
    .from("users")
    .select("id, kyc_level, status")
    .eq("username", recipientUsername)
    .maybeSingle();

  if (recipientErr) throw recipientErr;
  if (!recipient || recipient.status !== "active") {
    return withCors({ error: "Recipient not found. They must have a Doings account." }, { status: 404 });
  }

  if (recipient.kyc_level < 1) {
    return withCors({ error: "Recipient must verify their email before they can receive transfers." }, { status: 403 });
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

  const description = body.description?.trim()
    ? body.description.trim()
    : `Transfer to @${recipientUsername}`;

  try {
    const { data: transferId, error: transferErr } = await supabase.rpc("internal_transfer", {
      p_sender_wallet_id: senderWallet.id,
      p_receiver_wallet_id: recipientWallet.id,
      p_sender_user_id: sender.id,
      p_receiver_user_id: recipient.id,
      p_amount: smallestUnit,
      p_fee: P2P_TRANSFER_FEE,
      p_description: description,
      p_type: "send",
    });

    if (transferErr) throw transferErr;

    return withCors({
      ok: true,
      transfer_id: transferId,
      currency,
      amount: body.amount,
      recipient_username: recipientUsername,
    });
  } catch (err) {
    const msg = String(err);
    if (msg.includes("Insufficient")) {
      return withCors({ error: "Insufficient balance" }, { status: 400 });
    }
    return withCors({ error: "Transfer failed", detail: msg }, { status: 500 });
  }
});
