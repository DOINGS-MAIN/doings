import { corsHeaders, withCors } from "../_shared/cors.ts";
import { getAuthUserIdFromRequest, getServiceClient } from "../_shared/db.ts";
import { requireTransactionPin } from "../_shared/pin.ts";
import { checkRateLimit, RATE_LIMITS } from "../_shared/rate-limit.ts";

type SprayBody = {
  event_id: string;
  amount: number;
  denomination: 200 | 500 | 1000;
  pin: string;
  validate_only?: boolean;
};

async function resolveSprayer(supabase: ReturnType<typeof getServiceClient>, authUserId: string) {
  const { data: sprayer, error: sprayerErr } = await supabase
    .from("users")
    .select("id, kyc_level")
    .eq("auth_id", authUserId)
    .single();

  if (sprayerErr || !sprayer) {
    return { error: withCors({ error: "User not found" }, { status: 404 }) };
  }
  if (sprayer.kyc_level < 2) {
    return { error: withCors({ error: "KYC level 2 required to spray", code: "KYC_REQUIRED" }, { status: 403 }) };
  }
  return { sprayer };
}

function parseSprayBody(body: SprayBody) {
  if (!body.event_id || !body.amount || !body.denomination) {
    return { error: withCors({ error: "event_id, amount, and denomination are required" }, { status: 400 }) };
  }
  if (![200, 500, 1000].includes(body.denomination)) {
    return { error: withCors({ error: "denomination must be 200, 500, or 1000" }, { status: 400 }) };
  }

  const amountKobo = Math.round(body.amount * 100);
  if (amountKobo <= 0) {
    return { error: withCors({ error: "amount must be positive" }, { status: 400 }) };
  }

  const noteCount = amountKobo / (body.denomination * 100);
  if (!Number.isInteger(noteCount) || noteCount <= 0) {
    return { error: withCors({ error: "amount must be divisible by denomination" }, { status: 400 }) };
  }

  return { amountKobo, noteCount };
}

Deno.serve(async (req) => {
  if (req.method === "OPTIONS") return new Response("ok", { headers: corsHeaders });
  if (req.method !== "POST") return withCors({ error: "Method not allowed" }, { status: 405 });

  const authHeader = req.headers.get("Authorization");
  if (!authHeader) return withCors({ error: "Missing authorization" }, { status: 401 });

  const authUserId = await getAuthUserIdFromRequest(authHeader);
  if (!authUserId) return withCors({ error: "Unauthorized" }, { status: 401 });

  const supabase = getServiceClient();
  const sprayerResult = await resolveSprayer(supabase, authUserId);
  if ("error" in sprayerResult && sprayerResult.error) return sprayerResult.error;
  const sprayer = sprayerResult.sprayer!;

  const body = (await req.json()) as SprayBody;
  const parsed = parseSprayBody(body);
  if ("error" in parsed && parsed.error) return parsed.error;
  const { amountKobo, noteCount } = parsed;

  const pinCheck = await requireTransactionPin(supabase, sprayer.id, body.pin);
  if (pinCheck) return pinCheck;

  const { data: event, error: eventErr } = await supabase
    .from("events")
    .select("id, host_id, status")
    .eq("id", body.event_id)
    .single();

  if (eventErr || !event) return withCors({ error: "Event not found" }, { status: 404 });
  if (event.status !== "live") return withCors({ error: "Event is not live" }, { status: 400 });
  if (event.host_id === sprayer.id) {
    return withCors({ error: "Host cannot spray own event" }, { status: 400 });
  }

  const { data: sprayerWallet } = await supabase
    .from("wallets")
    .select("id, balance, locked_balance")
    .eq("user_id", sprayer.id)
    .eq("currency", "NGN")
    .single();

  if (!sprayerWallet) return withCors({ error: "Wallet not found" }, { status: 500 });

  const available = Number(sprayerWallet.balance) - Number(sprayerWallet.locked_balance ?? 0);
  if (available < amountKobo) {
    return withCors({ error: "Insufficient balance" }, { status: 400 });
  }

  if (body.validate_only) {
    return withCors({ ok: true, validated: true });
  }

  const rl = await checkRateLimit(RATE_LIMITS.spray(sprayer.id));
  if (!rl.allowed) {
    return withCors({ error: "Too many spray attempts. Try again shortly." }, { status: 429 });
  }

  try {
    const { data: transferId, error: sprayErr } = await supabase.rpc("record_event_spray", {
      p_event_id: body.event_id,
      p_sprayer_id: sprayer.id,
      p_amount_kobo: amountKobo,
      p_denomination: body.denomination,
      p_note_count: noteCount,
    });

    if (sprayErr) throw sprayErr;

    return withCors({ ok: true, transfer_id: transferId });
  } catch (error) {
    const msg = String(error);
    if (msg.includes("Insufficient balance")) {
      return withCors({ error: "Insufficient balance" }, { status: 400 });
    }
    if (msg.includes("not live")) {
      return withCors({ error: "Event is not live" }, { status: 400 });
    }
    if (msg.includes("Host cannot spray")) {
      return withCors({ error: "Host cannot spray own event" }, { status: 400 });
    }
    return withCors({ error: "Spray failed", detail: msg }, { status: 500 });
  }
});
