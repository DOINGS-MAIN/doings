import { corsHeaders, withCors } from "../_shared/cors.ts";
import { getAuthUserIdFromRequest, getServiceClient } from "../_shared/db.ts";
import { requireTransactionPin } from "../_shared/pin.ts";
import { checkRateLimit, RATE_LIMITS } from "../_shared/rate-limit.ts";
import {
  computeSprayTheatrePlan,
  parseSprayTheatreSettingsRow,
  theatrePlanToMetadata,
  type SprayDenominationNgn,
  type SprayTheatrePlan,
} from "../_shared/spray-theatre.ts";

type SpraySettlement = "partial" | "full" | "cancelled";

type SprayBody = {
  event_id: string;
  amount: number;
  denomination: 200 | 500 | 1000;
  pin: string;
  validate_only?: boolean;
  hold_id?: string;
  settlement?: SpraySettlement;
  sprayed_amount?: number;
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

  return { amountKobo, noteCount, amountMajor: body.amount };
}

async function loadSprayTheatreSettings(supabase: ReturnType<typeof getServiceClient>) {
  const { data, error } = await supabase
    .from("platform_settings")
    .select(
      "spray_stage_min_per_100k_denom_200, spray_stage_min_per_100k_denom_500, spray_stage_min_per_100k_denom_1000, spray_stage_min_per_100_usdc, spray_max_single_ngn_kobo, spray_guest_session_cap_sec, spray_max_stage_sec, spray_queue_compression_tiers",
    )
    .eq("id", 1)
    .single();

  if (error || !data) {
    return parseSprayTheatreSettingsRow({});
  }
  return parseSprayTheatreSettingsRow(data as Record<string, unknown>);
}

function buildTheatrePlan(
  settings: Awaited<ReturnType<typeof loadSprayTheatreSettings>>,
  amountMajor: number,
  denomination: SprayDenominationNgn,
): SprayTheatrePlan {
  return computeSprayTheatrePlan(settings, amountMajor, denomination, "NGN");
}

function mapSettleError(msg: string) {
  if (msg.includes("Insufficient balance")) {
    return withCors({ error: "Insufficient balance" }, { status: 400 });
  }
  if (msg.includes("not live")) {
    return withCors({ error: "Event is not live" }, { status: 400 });
  }
  if (msg.includes("not pending")) {
    return withCors({ error: "Spray session already settled", code: "SPRAY_HOLD_CLOSED" }, { status: 409 });
  }
  if (msg.includes("Not authorized")) {
    return withCors({ error: "Not authorized for this spray session" }, { status: 403 });
  }
  return withCors({ error: "Spray settlement failed", detail: msg }, { status: 500 });
}

async function settleHoldAndRespond(
  supabase: ReturnType<typeof getServiceClient>,
  sprayerId: string,
  holdId: string,
  settlement: SpraySettlement,
  sprayedKobo: number,
) {
  const { data: transferId, error: settleErr } = await supabase.rpc("settle_spray_hold", {
    p_hold_id: holdId,
    p_sprayer_id: sprayerId,
    p_settlement: settlement,
    p_sprayed_amount_kobo: sprayedKobo,
  });

  if (settleErr) throw settleErr;

  const { data: holdRow } = await supabase
    .from("spray_holds")
    .select("planned_amount_kobo, charged_amount_kobo, metadata")
    .eq("id", holdId)
    .single();

  const chargedKobo = settlement === "cancelled"
    ? 0
    : Number(holdRow?.charged_amount_kobo ?? holdRow?.planned_amount_kobo ?? 0);

  return withCors({
    ok: true,
    settlement,
    transfer_id: transferId ?? null,
    charged_amount: chargedKobo / 100,
    theatre_plan: holdRow?.metadata ?? null,
  });
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

  // ── Settle an existing hold (Phase 2) ──
  if (body.hold_id && body.settlement) {
    if (!["partial", "full", "cancelled"].includes(body.settlement)) {
      return withCors({ error: "settlement must be partial, full, or cancelled" }, { status: 400 });
    }

    const rl = await checkRateLimit(RATE_LIMITS.spray(sprayer.id));
    if (!rl.allowed) {
      return withCors({ error: "Too many spray attempts. Try again shortly." }, { status: 429 });
    }

    let sprayedKobo = 0;
    if (body.settlement === "partial") {
      if (body.sprayed_amount == null || body.sprayed_amount <= 0) {
        return withCors({ error: "sprayed_amount is required for partial settlement" }, { status: 400 });
      }
      sprayedKobo = Math.round(body.sprayed_amount * 100);
    }

    try {
      return await settleHoldAndRespond(
        supabase,
        sprayer.id,
        body.hold_id,
        body.settlement,
        sprayedKobo,
      );
    } catch (error) {
      return mapSettleError(String(error));
    }
  }

  // Legacy finish: older clients call send(event_id, amount, denomination, pin) after validate.
  if (
    body.event_id &&
    body.amount &&
    body.denomination &&
    body.pin &&
    !body.validate_only &&
    !body.hold_id &&
    !body.settlement
  ) {
    const pinCheck = await requireTransactionPin(supabase, sprayer.id, body.pin);
    if (pinCheck) return pinCheck;

    const legacyParsed = parseSprayBody(body);
    if ("error" in legacyParsed && legacyParsed.error) return legacyParsed.error;
    const { amountKobo: legacyAmountKobo } = legacyParsed;

    const rl = await checkRateLimit(RATE_LIMITS.spray(sprayer.id));
    if (!rl.allowed) {
      return withCors({ error: "Too many spray attempts. Try again shortly." }, { status: 429 });
    }

    const { data: hold } = await supabase
      .from("spray_holds")
      .select("id, planned_amount_kobo, metadata")
      .eq("sprayer_id", sprayer.id)
      .eq("event_id", body.event_id)
      .eq("denomination", body.denomination)
      .eq("status", "pending")
      .order("created_at", { ascending: false })
      .limit(1)
      .maybeSingle();

    if (!hold) {
      return withCors({ error: "No active spray session found. Start spray again." }, { status: 400 });
    }

    const plannedKobo = Number(hold.planned_amount_kobo);
    const settlement: SpraySettlement = legacyAmountKobo >= plannedKobo ? "full" : "partial";
    const sprayedKobo = settlement === "partial" ? legacyAmountKobo : 0;

    try {
      return await settleHoldAndRespond(
        supabase,
        sprayer.id,
        hold.id,
        settlement,
        sprayedKobo,
      );
    } catch (error) {
      return mapSettleError(String(error));
    }
  }

  const parsed = parseSprayBody(body);
  if ("error" in parsed && parsed.error) return parsed.error;
  const { amountKobo, noteCount, amountMajor } = parsed;

  const theatreSettings = await loadSprayTheatreSettings(supabase);

  if (amountKobo > theatreSettings.max_single_spray_ngn_kobo) {
    return withCors({
      error: `Maximum spray is ₦${theatreSettings.max_single_spray_ngn.toLocaleString()}`,
      code: "SPRAY_MAX_EXCEEDED",
    }, { status: 400 });
  }

  let theatrePlan: SprayTheatrePlan;
  try {
    theatrePlan = buildTheatrePlan(theatreSettings, amountMajor, body.denomination);
  } catch (err) {
    return withCors({ error: String(err) }, { status: 400 });
  }

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
    const holdExpiresSec = theatrePlan.session_duration_sec + 600;

    try {
      await supabase.rpc("release_expired_spray_holds");

      const { data: holdId, error: holdErr } = await supabase.rpc("create_spray_hold", {
        p_event_id: body.event_id,
        p_sprayer_id: sprayer.id,
        p_amount_kobo: amountKobo,
        p_denomination: body.denomination,
        p_note_count: noteCount,
        p_metadata: theatrePlanToMetadata(theatrePlan),
        p_expires_sec: holdExpiresSec,
      });

      if (holdErr) throw holdErr;

      return withCors({
        ok: true,
        validated: true,
        hold_id: holdId,
        theatre_plan: theatrePlan,
      });
    } catch (error) {
      const msg = String(error);
      if (msg.includes("Insufficient balance")) {
        return withCors({ error: "Insufficient balance" }, { status: 400 });
      }
      return withCors({ error: "Could not reserve spray funds", detail: msg }, { status: 500 });
    }
  }

  return withCors({
    error: "Use validate_only to start a spray or hold_id + settlement to finish",
  }, { status: 400 });
});
