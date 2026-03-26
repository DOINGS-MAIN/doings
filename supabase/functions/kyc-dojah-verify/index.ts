import { corsHeaders, withCors } from "../_shared/cors.ts";
import { sha256Hex } from "../_shared/crypto.ts";
import { getAuthedClient, getServiceClient } from "../_shared/db.ts";

type VerifyBody = {
  level: 2 | 3;
  bvn?: string;
  nin?: string;
  dateOfBirth?: string;
  selfieBase64?: string;
};

function cleanDigits(input: string | undefined) {
  return (input ?? "").replace(/\D/g, "");
}

Deno.serve(async (req) => {
  if (req.method === "OPTIONS") return new Response("ok", { headers: corsHeaders });
  if (req.method !== "POST") return withCors({ error: "Method not allowed" }, { status: 405 });

  const authHeader = req.headers.get("Authorization");
  if (!authHeader) return withCors({ error: "Missing authorization header" }, { status: 401 });

  const dojahAppId = Deno.env.get("DOJAH_APP_ID");
  const dojahSecret = Deno.env.get("DOJAH_SECRET_KEY");
  if (!dojahAppId || !dojahSecret) {
    return withCors({ error: "Dojah credentials not configured" }, { status: 500 });
  }

  const authedClient = getAuthedClient(authHeader);
  const { data: authData, error: authError } = await authedClient.auth.getUser();
  if (authError || !authData.user) return withCors({ error: "Unauthorized" }, { status: 401 });

  const supabase = getServiceClient();
  const { data: userRow, error: userErr } = await supabase
    .from("users")
    .select("id, kyc_level")
    .eq("auth_id", authData.user.id)
    .single();

  if (userErr || !userRow) return withCors({ error: "User profile not found" }, { status: 404 });

  const body = (await req.json()) as VerifyBody;
  if (body.level !== 2 && body.level !== 3) {
    return withCors({ error: "level must be 2 or 3" }, { status: 400 });
  }

  try {
    const since = new Date(Date.now() - 24 * 60 * 60 * 1000).toISOString();
    const { count: attemptsCount, error: countErr } = await supabase
      .from("kyc_verifications")
      .select("id", { count: "exact", head: true })
      .eq("user_id", userRow.id)
      .gte("created_at", since);
    if (countErr) throw countErr;
    if ((attemptsCount ?? 0) >= 3) {
      return withCors({ error: "KYC attempt limit reached. Try again after 24 hours." }, { status: 429 });
    }

    if (body.level === 2) {
      const bvn = cleanDigits(body.bvn);
      if (bvn.length !== 11) return withCors({ error: "BVN must be 11 digits" }, { status: 400 });

      const url = new URL("https://api.dojah.io/api/v1/kyc/bvn");
      url.searchParams.set("bvn", bvn);
      const dojahRes = await fetch(url.toString(), {
        headers: {
          Authorization: dojahAppId,
          AppId: dojahAppId,
        },
      });
      const rawResponse = await dojahRes.json();
      if (!dojahRes.ok) {
        throw new Error(`Dojah BVN verification failed: ${dojahRes.status}`);
      }

      const entity = rawResponse?.entity ?? rawResponse?.data ?? {};
      const bvnFirstName = (entity.first_name ?? entity.firstName ?? "").trim();
      const bvnLastName = (entity.last_name ?? entity.lastName ?? "").trim();
      const bvnMiddleName = (entity.middle_name ?? entity.middleName ?? "").trim();
      const verifiedFullName = [bvnFirstName, bvnMiddleName, bvnLastName].filter(Boolean).join(" ");

      if (!bvnFirstName || !bvnLastName) {
        throw new Error("Dojah BVN response missing first_name or last_name");
      }

      const bvnHash = await sha256Hex(bvn);
      const { error } = await supabase.from("kyc_verifications").insert({
        user_id: userRow.id,
        level: 2,
        status: "verified",
        provider: "dojah",
        bvn_hash: bvnHash,
        bvn_last_four: bvn.slice(-4),
        bvn_first_name: bvnFirstName,
        bvn_last_name: bvnLastName,
        bvn_dob: entity.date_of_birth ?? entity.dateOfBirth ?? body.dateOfBirth ?? null,
        raw_response: rawResponse,
        verified_at: new Date().toISOString(),
      });
      if (error) throw error;

      await supabase
        .from("users")
        .update({ full_name: verifiedFullName })
        .eq("id", userRow.id);

      return withCors({ ok: true, level: 2, verified_name: verifiedFullName });
    }

    const nin = cleanDigits(body.nin);
    if (nin.length !== 11) return withCors({ error: "NIN must be 11 digits" }, { status: 400 });
    if (!body.selfieBase64) return withCors({ error: "selfieBase64 is required for level 3" }, { status: 400 });

    const dojahRes = await fetch("https://api.dojah.io/api/v1/kyc/selfie/nin_verification", {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        Authorization: dojahAppId,
        AppId: dojahAppId,
      },
      body: JSON.stringify({
        nin,
        selfie_image: body.selfieBase64,
      }),
    });
    const rawResponse = await dojahRes.json();
    if (!dojahRes.ok) throw new Error(`Dojah NIN verification failed: ${dojahRes.status}`);

    const ninHash = await sha256Hex(nin);
    const confidence = Number((rawResponse?.entity?.selfie_verification?.confidence ?? 0));
    const status = confidence >= 80 ? "verified" : "rejected";

    const { error } = await supabase.from("kyc_verifications").insert({
      user_id: userRow.id,
      level: 3,
      status,
      provider: "dojah",
      nin_hash: ninHash,
      nin_last_four: nin.slice(-4),
      selfie_match_confidence: confidence,
      raw_response: rawResponse,
      verified_at: status === "verified" ? new Date().toISOString() : null,
      rejection_reason: status === "rejected" ? "Low selfie confidence score" : null,
    });
    if (error) throw error;

    return withCors({ ok: status === "verified", level: 3, status, confidence });
  } catch (error) {
    return withCors({ error: "KYC verification failed", detail: String(error) }, { status: 500 });
  }
});
