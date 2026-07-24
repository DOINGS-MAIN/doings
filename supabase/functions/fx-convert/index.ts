import { corsHeaders, withCors } from "../_shared/cors.ts";
import { getAuthUserIdFromRequest, getServiceClient, resolveAppUserId } from "../_shared/db.ts";
import { requireTransactionPin } from "../_shared/pin.ts";
import { checkRateLimit, RATE_LIMITS } from "../_shared/rate-limit.ts";

type ConvertBody = {
  quote_id: string;
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
  const userId = await resolveAppUserId(authHeader);
  if (!userId) return withCors({ error: "User not found" }, { status: 404 });

  const body = (await req.json()) as ConvertBody;
  if (!body.quote_id || !body.pin) {
    return withCors({ error: "quote_id and pin are required" }, { status: 400 });
  }

  const pinCheck = await requireTransactionPin(supabase, userId, body.pin);
  if (pinCheck) return pinCheck;

  const rl = await checkRateLimit(RATE_LIMITS.transfer(userId));
  if (!rl.allowed) return withCors({ error: "Too many requests. Try again shortly." }, { status: 429 });

  try {
    const { data: txnId, error } = await supabase.rpc("execute_fx_swap", {
      p_quote_id: body.quote_id,
      p_user_id: userId,
    });

    if (error) throw error;

    const { data: quote } = await supabase
      .from("fx_quotes")
      .select("side, usdc_micro, ngn_net_kobo, fee_kobo, effective_rate_kobo")
      .eq("id", body.quote_id)
      .single();

    return withCors({
      ok: true,
      transaction_id: txnId,
      side: quote?.side,
      usdc: quote ? Number(quote.usdc_micro) / 1_000_000 : undefined,
      ngn_net: quote ? Number(quote.ngn_net_kobo) / 100 : undefined,
      fee_naira: quote ? Number(quote.fee_kobo) / 100 : undefined,
      rate_naira: quote ? Number(quote.effective_rate_kobo) / 100 : undefined,
    });
  } catch (err) {
    const msg = String(err);
    if (msg.includes("expired") || msg.includes("QUOTE_EXPIRED")) {
      return withCors({ error: "Quote expired. Refresh the rate and try again.", code: "QUOTE_EXPIRED" }, { status: 410 });
    }
    if (msg.includes("no longer valid")) {
      return withCors({ error: "Quote already used.", code: "QUOTE_USED" }, { status: 409 });
    }
    if (msg.includes("Insufficient")) {
      return withCors({ error: msg.includes("liquidity") ? msg : "Insufficient balance", code: "INSUFFICIENT" }, { status: 400 });
    }
    return withCors({ error: "Conversion failed", detail: msg }, { status: 500 });
  }
});
