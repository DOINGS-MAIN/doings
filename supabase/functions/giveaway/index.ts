import { corsHeaders, withCors } from "../_shared/cors.ts";
import { getAuthedClient, getServiceClient } from "../_shared/db.ts";

type CreateBody = {
  title: string;
  total_amount: number;
  per_person_amount: number;
  type: "live" | "scheduled";
  event_id?: string;
  is_private?: boolean;
  show_on_event_screen?: boolean;
};

type RedeemBody = {
  code: string;
};

type StopBody = {
  giveaway_id: string;
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

Deno.serve(async (req) => {
  if (req.method === "OPTIONS") return new Response("ok", { headers: corsHeaders });

  const authHeader = req.headers.get("Authorization");
  if (!authHeader) return withCors({ error: "Missing authorization" }, { status: 401 });

  const authedClient = getAuthedClient(authHeader);
  const { data: authData, error: authError } = await authedClient.auth.getUser();
  if (authError || !authData.user) return withCors({ error: "Unauthorized" }, { status: 401 });

  const supabase = getServiceClient();
  const { data: user, error: userErr } = await supabase
    .from("users")
    .select("id, kyc_level")
    .eq("auth_id", authData.user.id)
    .single();

  if (userErr || !user) return withCors({ error: "User not found" }, { status: 404 });

  const { action, id } = getPathAction(req.url);

  // ── GET: list my giveaways ──
  if (req.method === "GET" && action === "root") {
    const { data, error } = await supabase
      .from("giveaways")
      .select("*, giveaway_redemptions(count)")
      .eq("creator_id", user.id)
      .order("created_at", { ascending: false });
    if (error) return withCors({ error: error.message }, { status: 500 });
    return withCors(data);
  }

  // ── GET: by code ──
  if (req.method === "GET" && action === "get_by_code" && id) {
    const { data, error } = await supabase
      .from("giveaways")
      .select("id, title, per_person_amount, remaining_amount, status, type, code, creator_id, event_id, is_private, created_at")
      .eq("code", id.toUpperCase())
      .single();
    if (error || !data) return withCors({ error: "Giveaway not found" }, { status: 404 });
    return withCors(data);
  }

  // ── GET: by id ──
  if (req.method === "GET" && action === "get_by_id" && id) {
    const { data, error } = await supabase
      .from("giveaways")
      .select("*, giveaway_redemptions(id, user_id, amount, redeemed_at)")
      .eq("id", id)
      .single();
    if (error || !data) return withCors({ error: "Giveaway not found" }, { status: 404 });
    return withCors(data);
  }

  // ── POST /redeem ──
  if (req.method === "POST" && action === "redeem") {
    const body = (await req.json()) as RedeemBody;
    if (!body.code) return withCors({ error: "code is required" }, { status: 400 });

    const { data: giveaway, error: gErr } = await supabase
      .from("giveaways")
      .select("id, creator_id, per_person_amount, remaining_amount, status")
      .eq("code", body.code.toUpperCase())
      .single();

    if (gErr || !giveaway) return withCors({ error: "Giveaway not found" }, { status: 404 });
    if (giveaway.status !== "active") return withCors({ error: "Giveaway is no longer active" }, { status: 400 });
    if (giveaway.creator_id === user.id) return withCors({ error: "Cannot redeem your own giveaway" }, { status: 400 });
    if (giveaway.remaining_amount < giveaway.per_person_amount) {
      return withCors({ error: "Giveaway is exhausted" }, { status: 400 });
    }

    const { data: existing } = await supabase
      .from("giveaway_redemptions")
      .select("id")
      .eq("giveaway_id", giveaway.id)
      .eq("user_id", user.id)
      .maybeSingle();

    if (existing) return withCors({ error: "You have already redeemed this giveaway" }, { status: 409 });

    const { data: creatorWallet } = await supabase
      .from("wallets")
      .select("id")
      .eq("user_id", giveaway.creator_id)
      .eq("currency", "NGN")
      .single();

    const { data: recipientWallet } = await supabase
      .from("wallets")
      .select("id")
      .eq("user_id", user.id)
      .eq("currency", "NGN")
      .single();

    if (!creatorWallet || !recipientWallet) {
      return withCors({ error: "Wallet not found" }, { status: 500 });
    }

    try {
      const idempotencyKey = `giveaway-redeem-${giveaway.id}-${user.id}`;
      const { data: txnId, error: creditErr } = await supabase.rpc("credit_wallet", {
        p_wallet_id: recipientWallet.id,
        p_user_id: user.id,
        p_amount: giveaway.per_person_amount,
        p_fee: 0,
        p_type: "giveaway",
        p_description: `Giveaway redemption: ${giveaway.id}`,
        p_provider: "internal",
        p_idempotency_key: idempotencyKey,
        p_metadata: { giveaway_id: giveaway.id },
      });
      if (creditErr) throw creditErr;

      const { error: redemptionErr } = await supabase
        .from("giveaway_redemptions")
        .insert({
          giveaway_id: giveaway.id,
          user_id: user.id,
          amount: giveaway.per_person_amount,
          transaction_id: txnId,
        });
      if (redemptionErr) throw redemptionErr;

      return withCors({ ok: true, amount: giveaway.per_person_amount, transaction_id: txnId });
    } catch (err) {
      return withCors({ error: "Redemption failed", detail: String(err) }, { status: 500 });
    }
  }

  // ── POST /stop ──
  if (req.method === "POST" && action === "stop") {
    const body = (await req.json()) as StopBody;
    if (!body.giveaway_id) return withCors({ error: "giveaway_id is required" }, { status: 400 });

    const { data: giveaway, error: gErr } = await supabase
      .from("giveaways")
      .select("id, creator_id, remaining_amount, status, funding_transaction_id")
      .eq("id", body.giveaway_id)
      .single();

    if (gErr || !giveaway) return withCors({ error: "Giveaway not found" }, { status: 404 });
    if (giveaway.creator_id !== user.id) return withCors({ error: "Only the creator can stop a giveaway" }, { status: 403 });
    if (giveaway.status !== "active") return withCors({ error: "Giveaway is not active" }, { status: 400 });

    try {
      if (giveaway.remaining_amount > 0) {
        const { data: creatorWallet } = await supabase
          .from("wallets")
          .select("id")
          .eq("user_id", user.id)
          .eq("currency", "NGN")
          .single();

        if (!creatorWallet) throw new Error("Creator wallet not found");

        const idempotencyKey = `giveaway-refund-${giveaway.id}`;
        const { data: refundTxnId, error: refundErr } = await supabase.rpc("credit_wallet", {
          p_wallet_id: creatorWallet.id,
          p_user_id: user.id,
          p_amount: giveaway.remaining_amount,
          p_fee: 0,
          p_type: "giveaway_refund",
          p_description: `Giveaway refund: ${giveaway.id}`,
          p_provider: "internal",
          p_idempotency_key: idempotencyKey,
          p_metadata: { giveaway_id: giveaway.id },
        });
        if (refundErr) throw refundErr;

        await supabase
          .from("giveaways")
          .update({
            status: "stopped",
            remaining_amount: 0,
            refund_transaction_id: refundTxnId,
            stopped_at: new Date().toISOString(),
          })
          .eq("id", giveaway.id);

        return withCors({ ok: true, refunded: giveaway.remaining_amount, refund_transaction_id: refundTxnId });
      }

      await supabase
        .from("giveaways")
        .update({ status: "stopped", stopped_at: new Date().toISOString() })
        .eq("id", giveaway.id);

      return withCors({ ok: true, refunded: 0 });
    } catch (err) {
      return withCors({ error: "Stop failed", detail: String(err) }, { status: 500 });
    }
  }

  // ── POST / (create) ──
  if (req.method === "POST" && action === "root") {
    if (user.kyc_level < 2) return withCors({ error: "KYC level 2 required to create giveaways" }, { status: 403 });

    const body = (await req.json()) as CreateBody;
    if (!body.title || !body.total_amount || !body.per_person_amount || !body.type) {
      return withCors({ error: "title, total_amount, per_person_amount, and type are required" }, { status: 400 });
    }

    const totalKobo = Math.round(body.total_amount * 100);
    const perPersonKobo = Math.round(body.per_person_amount * 100);

    if (totalKobo < 10000) return withCors({ error: "Minimum total is ₦100" }, { status: 400 });
    if (perPersonKobo < 1000) return withCors({ error: "Minimum per person is ₦10" }, { status: 400 });
    if (perPersonKobo > totalKobo) return withCors({ error: "per_person_amount cannot exceed total_amount" }, { status: 400 });
    if (totalKobo % perPersonKobo !== 0) {
      return withCors({ error: "total_amount must be evenly divisible by per_person_amount" }, { status: 400 });
    }

    const { data: wallet } = await supabase
      .from("wallets")
      .select("id")
      .eq("user_id", user.id)
      .eq("currency", "NGN")
      .single();

    if (!wallet) return withCors({ error: "NGN wallet not found" }, { status: 500 });

    try {
      const idempotencyKey = `giveaway-fund-${user.id}-${Date.now()}`;
      const { data: fundTxnId, error: debitErr } = await supabase.rpc("debit_wallet", {
        p_wallet_id: wallet.id,
        p_user_id: user.id,
        p_amount: totalKobo,
        p_fee: 0,
        p_type: "giveaway",
        p_description: `Giveaway funding: ${body.title}`,
        p_provider: "internal",
        p_idempotency_key: idempotencyKey,
        p_metadata: { title: body.title },
      });
      if (debitErr) throw debitErr;

      const { data: giveaway, error: insertErr } = await supabase
        .from("giveaways")
        .insert({
          creator_id: user.id,
          title: body.title,
          total_amount: totalKobo,
          per_person_amount: perPersonKobo,
          remaining_amount: totalKobo,
          type: body.type,
          event_id: body.event_id ?? null,
          is_private: body.is_private ?? false,
          show_on_event_screen: body.show_on_event_screen ?? true,
          funding_transaction_id: fundTxnId,
        })
        .select("id, code, total_amount, per_person_amount, max_recipients, status")
        .single();

      if (insertErr) throw insertErr;

      return withCors({ ok: true, giveaway }, { status: 201 });
    } catch (err) {
      const msg = String(err);
      if (msg.includes("Insufficient")) {
        return withCors({ error: "Insufficient balance to fund giveaway" }, { status: 400 });
      }
      return withCors({ error: "Giveaway creation failed", detail: msg }, { status: 500 });
    }
  }

  return withCors({ error: "Not found" }, { status: 404 });
});
