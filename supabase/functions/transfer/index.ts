import { corsHeaders, withCors } from "../_shared/cors.ts";
import { parseMajorAmount } from "../_shared/money.ts";
import { accountBlock } from "../_shared/account.ts";
import { getAuthUserIdFromRequest, getServiceClient, resolveAppUserId } from "../_shared/db.ts";
import { checkTransferLimit, transferDailyLimit } from "../_shared/limits.ts";
import { checkRateLimit, RATE_LIMITS } from "../_shared/rate-limit.ts";
import { requireTransactionPin } from "../_shared/pin.ts";
import { normalizeUsername, USERNAME_RE } from "../_shared/username.ts";

/** In-app P2P sends are always fee-free — never apply withdrawal/platform fees here. */

const IDEMPOTENCY_KEY_RE = /^[A-Za-z0-9_-]{8,64}$/;

type TransferBody = {
  recipient_username: string;
  amount: number;
  currency?: "NGN" | "USDC";
  description?: string;
  pin: string;
  /** One per send attempt (the app keeps it across a retry), so a repeat returns the first transfer. */
  idempotency_key?: string;
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
    .select("id, kyc_level, status")
    .eq("id", senderId)
    .single();

  if (senderErr || !sender) return withCors({ error: "User not found" }, { status: 404 });
  const blocked = accountBlock(sender.status);
  if (blocked) return withCors(blocked, { status: 403 });
  if (sender.kyc_level < 2) return withCors({ error: "Complete identity verification (BVN + selfie) to send money" }, { status: 403 });

  const body = (await req.json()) as TransferBody;
  const pinCheck = await requireTransactionPin(supabase, sender.id, body.pin);
  if (pinCheck) return pinCheck;

  const rl = await checkRateLimit(RATE_LIMITS.transfer(sender.id));
  if (!rl.allowed) return withCors({ error: "Too many transfer requests. Try again shortly." }, { status: 429 });

  const idempotencyKey = body.idempotency_key == null ? null : String(body.idempotency_key);
  if (idempotencyKey !== null && !IDEMPOTENCY_KEY_RE.test(idempotencyKey)) {
    return withCors({ error: "Invalid idempotency_key" }, { status: 400 });
  }

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
  const smallestUnit = parseMajorAmount(body.amount, currency);
  if (smallestUnit === null) return withCors({ error: "amount must be positive" }, { status: 400 });

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

  // A repeat of a send that already went through gets the same answer, before the limit pre-check
  // (which would now count the first one against it). The database decides again under its lock.
  if (idempotencyKey) {
    const { data: earlier } = await supabase
      .from("transfers")
      .select("id, amount, currency, receiver_user_id")
      .eq("sender_user_id", sender.id)
      .eq("idempotency_key", idempotencyKey)
      .maybeSingle();
    // Anything that differs is left to the database, which refuses a key reused for another send.
    if (
      earlier && earlier.currency === currency && Number(earlier.amount) === smallestUnit &&
      earlier.receiver_user_id === recipient.id
    ) {
      return withCors({
        ok: true,
        transfer_id: earlier.id,
        currency,
        amount: body.amount,
        recipient_username: recipientUsername,
        repeated: true,
      });
    }
  }

  const { allowed, reason } = await checkTransferLimit(sender.id, sender.kyc_level, currency, smallestUnit);
  if (!allowed) return withCors({ error: reason }, { status: 403 });

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
    // The daily limit is checked again inside the database, under a per-sender lock (migration 107):
    // the check above reads "spent today" before the debit, so parallel requests all passed it.
    const { data: transferId, error: transferErr } = await supabase.rpc("internal_transfer_checked", {
      p_sender_wallet_id: senderWallet.id,
      p_receiver_wallet_id: recipientWallet.id,
      p_sender_user_id: sender.id,
      p_receiver_user_id: recipient.id,
      p_amount: smallestUnit,
      p_description: description,
      p_daily_limit: transferDailyLimit(currency, sender.kyc_level),
      // Only sent when the client gave one, so this function also runs against a database without 108.
      ...(idempotencyKey ? { p_idempotency_key: idempotencyKey } : {}),
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
    const msg = (err as { message?: string })?.message ?? String(err);
    if (msg.includes("Insufficient")) {
      return withCors({ error: "Insufficient balance" }, { status: 400 });
    }
    if (msg.includes("IDEMPOTENCY_KEY_REUSED")) {
      return withCors({ error: "This send was already used for a different transfer. Start it again." }, { status: 409 });
    }
    if (msg.includes("DAILY_TRANSFER_LIMIT")) {
      return withCors({ error: "Daily transfer limit exceeded" }, { status: 403 });
    }
    console.error("transfer failed", msg);
    return withCors({ error: "Transfer failed" }, { status: 500 });
  }
});
