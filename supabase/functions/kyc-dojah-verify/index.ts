import { corsHeaders, withCors } from "../_shared/cors.ts";
import { getAuthUserIdFromRequest, getServiceClient } from "../_shared/db.ts";
import { dojahHeaders, dojahPostJson } from "../_shared/dojahClient.ts";
import { kycHmac } from "../_shared/kycHash.ts";
import { KYC_ERRORS, verifyBvnSelfie, type VerifyDeps } from "../_shared/kycSelfie.ts";

// Level 2 = BVN + selfie (Dojah liveness, then BVN lookup with face match). One BVN per account.
// Never log the BVN, the selfie or Dojah bodies.

Deno.serve(async (req) => {
  if (req.method === "OPTIONS") return new Response("ok", { headers: corsHeaders });
  if (req.method !== "POST") return withCors({ error: "Method not allowed" }, { status: 405 });

  const authHeader = req.headers.get("Authorization");
  if (!authHeader) return withCors({ error: "Missing authorization header" }, { status: 401 });

  const authUserId = await getAuthUserIdFromRequest(authHeader);
  if (!authUserId) return withCors({ error: "Unauthorized" }, { status: 401 });

  const dojahAppId = Deno.env.get("DOJAH_APP_ID");
  const dojahSecret = Deno.env.get("DOJAH_SECRET_KEY");
  const hashSecret = Deno.env.get("KYC_HASH_SECRET");
  if (!dojahAppId || !dojahSecret || !hashSecret) {
    console.error("kyc-dojah-verify: missing DOJAH_APP_ID / DOJAH_SECRET_KEY / KYC_HASH_SECRET");
    const [status, error] = KYC_ERRORS.unavailable;
    return withCors({ error, code: "unavailable" }, { status });
  }

  const supabase = getServiceClient();
  const { data: userRow, error: userErr } = await supabase
    .from("users")
    .select("id, kyc_level, full_name")
    .eq("auth_id", authUserId)
    .single();
  if (userErr || !userRow) return withCors({ error: "User profile not found" }, { status: 404 });

  if (userRow.kyc_level < 1) return withCors({ error: "Verify your email first." }, { status: 403 });
  if (userRow.kyc_level >= 2) {
    return withCors({ ok: true, already_verified: true, level: 2, verified_name: userRow.full_name });
  }

  let body: Record<string, unknown> = {};
  try {
    const parsed = await req.json();
    if (parsed && typeof parsed === "object") body = parsed as Record<string, unknown>;
  } catch {
    // empty / invalid JSON → fails validation below
  }

  const headers = dojahHeaders(dojahAppId, dojahSecret);
  const limitKey = `kyc-l2:${userRow.id}`;
  const budgetKey = `kyc-dojah:${userRow.id}`;

  const deps: VerifyDeps = {
    hmac: (bvn) => kycHmac(bvn, hashSecret),
    consumeAttempt: async () => {
      const { data, error } = await supabase.rpc("consume_rate_limit", {
        p_key: limitKey,
        p_max: 5,
        p_window_seconds: 86400,
      });
      if (error) throw error;
      return data === true;
    },
    releaseAttempt: async () => {
      const { error } = await supabase.rpc("release_rate_limit", { p_key: limitKey });
      if (error) console.error("kyc release_rate_limit failed", { user: userRow.id, code: error.code });
    },
    bvnLinkedElsewhere: async (bvnHmac) => {
      const { count, error } = await supabase
        .from("kyc_verifications")
        .select("id", { count: "exact", head: true })
        .eq("bvn_hmac", bvnHmac)
        .eq("status", "verified")
        .eq("level", 2)
        .is("superseded_at", null)
        .neq("user_id", userRow.id);
      if (error) throw error;
      return (count ?? 0) > 0;
    },
    consumeDojahBudget: async () => {
      const { data, error } = await supabase.rpc("consume_rate_limit", {
        p_key: budgetKey,
        p_max: 15,
        p_window_seconds: 86400,
      });
      if (error) throw error;
      return data === true;
    },
    livenessMinScore: async () => {
      const { data, error } = await supabase
        .from("platform_settings")
        .select("kyc_liveness_min_score")
        .limit(1)
        .single();
      if (error) throw error;
      return Number(data.kyc_liveness_min_score);
    },
    liveness: (image) => dojahPostJson("/api/v1/ml/liveness", { image }, headers),
    bvnSelfie: (bvn, image) => dojahPostJson("/api/v1/kyc/bvn/verify", { bvn, selfie_image: image }, headers),
    insertVerified: async (row, payload) => {
      // Re-verification: the user's own older active record must step aside for the unique BVN index (086).
      const { data: older, error: supErr } = await supabase
        .from("kyc_verifications")
        .update({ superseded_at: new Date().toISOString() })
        .eq("user_id", userRow.id)
        .eq("status", "verified")
        .eq("level", 2)
        .is("superseded_at", null)
        .select("id");
      if (supErr) throw supErr;
      const restoreOlder = async () => {
        const ids = (older ?? []).map((r) => r.id);
        if (ids.length) await supabase.from("kyc_verifications").update({ superseded_at: null }).in("id", ids);
      };
      const { data, error } = await supabase
        .from("kyc_verifications")
        .insert({
          ...row,
          user_id: userRow.id,
          level: 2,
          status: "verified",
          provider: "dojah",
          verification_method: "bvn_selfie",
          verified_at: new Date().toISOString(),
        })
        .select("id")
        .single();
      if (error) {
        await restoreOlder();
        if (error.code === "23505") return "duplicate";
        throw error;
      }
      const { error: payloadErr } = await supabase
        .from("kyc_verification_payloads")
        .insert({ kyc_id: data.id, payload });
      if (payloadErr) console.error("kyc payload insert failed", { user: userRow.id, code: payloadErr.code });
      return "ok";
    },
  };

  try {
    const out = await verifyBvnSelfie(body, deps);
    if (!out.ok) {
      // Scores (numbers only) let us tune kyc_liveness_min_score; they never go to the client.
      console.info("kyc-dojah-verify refused", { user: userRow.id, code: out.code, ...out.scores });
      return withCors({ error: out.error, code: out.code }, { status: out.status });
    }
    await supabase.from("users").update({ full_name: out.fullName }).eq("id", userRow.id);
    return withCors({ ok: true, level: 2, verified_name: out.fullName });
  } catch (error) {
    console.error("kyc-dojah-verify failed", {
      user: userRow.id,
      error: error instanceof Error ? error.name : "unknown",
    });
    return withCors({ error: "KYC verification failed" }, { status: 500 });
  }
});
