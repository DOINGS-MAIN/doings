import { corsHeaders, withCors } from "../_shared/cors.ts";
import { getAuthUserIdFromRequest, getServiceClient } from "../_shared/db.ts";
import { requireTransactionPin } from "../_shared/pin.ts";
import { checkRateLimit, RATE_LIMITS } from "../_shared/rate-limit.ts";

type CreateBody = {
  title: string;
  total_amount: number;
  per_person_amount: number;
  type: "live" | "scheduled";
  event_id?: string;
  is_private?: boolean;
  show_on_event_screen?: boolean;
  pin: string;
};

type RedeemBody = {
  code: string;
};

type StopBody = {
  giveaway_id: string;
  pin: string;
};

function getPathAction(url: string): { action: string; id?: string } {
  const u = new URL(url);
  const parts = u.pathname.split("/").filter(Boolean);
  const fnIdx = parts.indexOf("giveaway");
  const rest = parts.slice(fnIdx + 1);

  if (rest[0] === "redeem") return { action: "redeem" };
  if (rest[0] === "stop") return { action: "stop" };
  if (rest[0] === "code" && rest[1]) return { action: "get_by_code", id: rest[1] };
  if (rest[0]) return { action: "get_by_id", id: rest[0] };
  return { action: "root" };
}

function rpcErrorMessage(err: unknown): string {
  const msg = String(err);
  if (msg.includes("Insufficient")) return "Insufficient balance to fund giveaway";
  if (msg.includes("Minimum total")) return "Minimum total is ₦100";
  if (msg.includes("Minimum per person")) return "Minimum per person is ₦10";
  if (msg.includes("evenly divisible")) {
    return "total_amount must be evenly divisible by per_person_amount";
  }
  if (msg.includes("Giveaway not found")) return "Giveaway not found";
  if (msg.includes("no longer active")) return "Giveaway is no longer active";
  if (msg.includes("Verify your email")) return "Verify your email to redeem giveaways";
  if (msg.includes("Cannot redeem your own")) return "Cannot redeem your own giveaway";
  if (msg.includes("exhausted")) return "Giveaway is exhausted";
  if (msg.includes("already redeemed")) return "You have already redeemed this giveaway";
  if (msg.includes("Only the creator")) return "Only the creator can stop a giveaway";
  if (msg.includes("not active")) return "Giveaway is not active";
  return msg.replace(/^Error:\s*/i, "").slice(0, 200);
}

Deno.serve(async (req) => {
  if (req.method === "OPTIONS") return new Response("ok", { headers: corsHeaders });

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

  const { action, id } = getPathAction(req.url);

  if (req.method === "GET" && action === "root") {
    const { data, error } = await supabase
      .from("giveaways")
      .select("*, giveaway_redemptions(count)")
      .eq("creator_id", user.id)
      .order("created_at", { ascending: false });
    if (error) return withCors({ error: error.message }, { status: 500 });
    return withCors(data);
  }

  if (req.method === "GET" && action === "get_by_code" && id) {
    const { data, error } = await supabase
      .from("giveaways")
      .select(
        "id, title, total_amount, per_person_amount, remaining_amount, status, type, code, creator_id, event_id, is_private, show_on_event_screen, created_at",
      )
      .eq("code", id.toUpperCase())
      .single();
    if (error || !data) return withCors({ error: "Giveaway not found" }, { status: 404 });

    const { data: creator } = await supabase
      .from("users")
      .select("full_name, username")
      .eq("id", data.creator_id)
      .maybeSingle();

    const creator_name =
      (creator?.full_name && String(creator.full_name).trim()) ||
      (creator?.username && String(creator.username).trim()) ||
      "Host";

    return withCors({ ...data, creator_name });
  }

  if (req.method === "GET" && action === "get_by_id" && id) {
    const { data, error } = await supabase
      .from("giveaways")
      .select("*, giveaway_redemptions(id, user_id, amount, redeemed_at)")
      .eq("id", id)
      .single();
    if (error || !data) return withCors({ error: "Giveaway not found" }, { status: 404 });
    return withCors(data);
  }

  if (req.method === "POST" && action === "redeem") {
    const body = (await req.json()) as RedeemBody;
    if (!body.code) return withCors({ error: "code is required" }, { status: 400 });

    const rate = await checkRateLimit(RATE_LIMITS.giveawayRedeem(user.id));
    if (!rate.allowed) {
      return withCors({ error: "Too many redemption attempts. Try again shortly." }, { status: 429 });
    }

    const { data, error } = await supabase.rpc("redeem_giveaway_code", {
      p_redeemer_id: user.id,
      p_code: body.code.toUpperCase(),
    });

    if (error) {
      const message = rpcErrorMessage(error);
      const status = message.includes("already redeemed") ? 409 : 400;
      return withCors({ error: message }, { status });
    }

    const result = data as Record<string, unknown>;
    return withCors({
      ok: true,
      amount: result.amount,
      transaction_id: result.transaction_id,
    });
  }

  if (req.method === "POST" && action === "stop") {
    const body = (await req.json()) as StopBody;
    if (!body.giveaway_id) return withCors({ error: "giveaway_id is required" }, { status: 400 });

    const pinCheck = await requireTransactionPin(supabase, user.id, body.pin);
    if (pinCheck) return pinCheck;

    const { data, error } = await supabase.rpc("stop_giveaway_funded", {
      p_creator_id: user.id,
      p_giveaway_id: body.giveaway_id,
    });

    if (error) {
      return withCors({ error: rpcErrorMessage(error) }, { status: 400 });
    }

    const result = data as Record<string, unknown>;
    return withCors({
      ok: true,
      refunded: result.refunded ?? 0,
      refund_transaction_id: result.refund_transaction_id,
    });
  }

  if (req.method === "POST" && action === "root") {
    if (user.kyc_level < 2) {
      return withCors({ error: "KYC level 2 required to create giveaways" }, { status: 403 });
    }

    const body = (await req.json()) as CreateBody;
    const pinCheck = await requireTransactionPin(supabase, user.id, body.pin);
    if (pinCheck) return pinCheck;

    if (!body.title || !body.total_amount || !body.per_person_amount || !body.type) {
      return withCors({ error: "title, total_amount, per_person_amount, and type are required" }, { status: 400 });
    }

    const totalKobo = Math.round(body.total_amount * 100);
    const perPersonKobo = Math.round(body.per_person_amount * 100);

    const { data, error } = await supabase.rpc("create_giveaway_funded", {
      p_creator_id: user.id,
      p_title: body.title,
      p_total_kobo: totalKobo,
      p_per_person_kobo: perPersonKobo,
      p_type: body.type,
      p_event_id: body.event_id ?? null,
      p_is_private: body.is_private ?? false,
      p_show_on_event_screen: body.show_on_event_screen ?? true,
      p_idempotency_key: `giveaway-fund-${user.id}-${crypto.randomUUID()}`,
    });

    if (error) {
      const message = rpcErrorMessage(error);
      const status = message.includes("Insufficient") ? 400 : 500;
      return withCors({ error: message }, { status });
    }

    return withCors({ ok: true, giveaway: data }, { status: 201 });
  }

  return withCors({ error: "Not found" }, { status: 404 });
});
