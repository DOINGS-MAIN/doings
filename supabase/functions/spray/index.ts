import { corsHeaders, withCors } from "../_shared/cors.ts";
import { getAuthedClient, getServiceClient } from "../_shared/db.ts";

type SprayBody = {
  event_id: string;
  amount: number;
  denomination: 200 | 500 | 1000;
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
  const { data: sprayer, error: sprayerErr } = await supabase
    .from("users")
    .select("id, kyc_level")
    .eq("auth_id", authData.user.id)
    .single();

  if (sprayerErr || !sprayer) return withCors({ error: "User not found" }, { status: 404 });
  if (sprayer.kyc_level < 2) return withCors({ error: "KYC level 2 required to spray" }, { status: 403 });

  const body = (await req.json()) as SprayBody;
  if (!body.event_id || !body.amount || !body.denomination) {
    return withCors({ error: "event_id, amount, and denomination are required" }, { status: 400 });
  }
  if (![200, 500, 1000].includes(body.denomination)) {
    return withCors({ error: "denomination must be 200, 500, or 1000" }, { status: 400 });
  }

  const amountKobo = Math.round(body.amount * 100);
  if (amountKobo <= 0) return withCors({ error: "amount must be positive" }, { status: 400 });

  const noteCount = amountKobo / (body.denomination * 100);
  if (!Number.isInteger(noteCount) || noteCount <= 0) {
    return withCors({ error: "amount must be divisible by denomination" }, { status: 400 });
  }

  const { data: event, error: eventErr } = await supabase
    .from("events")
    .select("id, host_id, status")
    .eq("id", body.event_id)
    .single();

  if (eventErr || !event) return withCors({ error: "Event not found" }, { status: 404 });
  if (event.status !== "live") return withCors({ error: "Event is not live" }, { status: 400 });
  if (event.host_id === sprayer.id) return withCors({ error: "Host cannot spray own event" }, { status: 400 });

  const { data: sprayerWallet } = await supabase
    .from("wallets")
    .select("id")
    .eq("user_id", sprayer.id)
    .eq("currency", "NGN")
    .single();

  const { data: hostWallet } = await supabase
    .from("wallets")
    .select("id")
    .eq("user_id", event.host_id)
    .eq("currency", "NGN")
    .single();

  if (!sprayerWallet || !hostWallet) {
    return withCors({ error: "Wallet not found" }, { status: 500 });
  }

  try {
    const { data: transferId, error: transferErr } = await supabase.rpc("internal_transfer", {
      p_sender_wallet_id: sprayerWallet.id,
      p_receiver_wallet_id: hostWallet.id,
      p_sender_user_id: sprayer.id,
      p_receiver_user_id: event.host_id,
      p_amount: amountKobo,
      p_fee: 0,
      p_description: `Spray at event ${event.id}`,
      p_type: "spray",
    });

    if (transferErr) throw transferErr;

    const { error: sprayErr } = await supabase
      .from("spray_records")
      .insert({
        event_id: event.id,
        sprayer_id: sprayer.id,
        receiver_id: event.host_id,
        amount: amountKobo,
        denomination: body.denomination,
        note_count: noteCount,
      });

    if (sprayErr) throw sprayErr;

    return withCors({ ok: true, transfer_id: transferId });
  } catch (error) {
    const msg = String(error);
    if (msg.includes("Insufficient balance")) {
      return withCors({ error: "Insufficient balance" }, { status: 400 });
    }
    return withCors({ error: "Spray failed", detail: msg }, { status: 500 });
  }
});
