import { corsHeaders, withCors } from "../_shared/cors.ts";
import { sha256Hex } from "../_shared/crypto.ts";
import { getAuthUserIdFromRequest, getServiceClient } from "../_shared/db.ts";
import { createReservedAccount } from "../_shared/monnify.ts";

type VerifyBody = {
  bvn: string;
  nin: string;
  dateOfBirth?: string;
};

function cleanDigits(input: string | undefined) {
  return (input ?? "").replace(/\D/g, "");
}

function normName(s: string) {
  return s.toLowerCase().replace(/[^a-z]/g, "");
}

function lastToken(name: string) {
  const parts = name.trim().split(/\s+/).filter(Boolean);
  return parts[parts.length - 1] ?? "";
}

function surnamesCompatible(bvnFull: string, ninFull: string): boolean {
  const a = normName(lastToken(bvnFull));
  const b = normName(lastToken(ninFull));
  if (!a || !b) return true;
  return a === b || a.includes(b) || b.includes(a);
}

function dojahHeaders(appId: string, secret: string) {
  return {
    Authorization: secret,
    AppId: appId,
  } as Record<string, string>;
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

  const authUserId = await getAuthUserIdFromRequest(authHeader);
  if (!authUserId) return withCors({ error: "Unauthorized" }, { status: 401 });

  const supabase = getServiceClient();
  const { data: userRow, error: userErr } = await supabase
    .from("users")
    .select("id, kyc_level, full_name, email")
    .eq("auth_id", authUserId)
    .single();

  if (userErr || !userRow) return withCors({ error: "User profile not found" }, { status: 404 });

  if (userRow.kyc_level >= 2) {
    return withCors({ error: "Identity is already verified at this tier" }, { status: 400 });
  }

  if (userRow.kyc_level < 1) {
    return withCors({ error: "Verify your email before completing BVN and NIN" }, { status: 403 });
  }

  const body = (await req.json()) as VerifyBody;
  const bvn = cleanDigits(body.bvn);
  const nin = cleanDigits(body.nin);
  if (bvn.length !== 11) return withCors({ error: "BVN must be 11 digits" }, { status: 400 });
  if (nin.length !== 11) return withCors({ error: "NIN must be 11 digits" }, { status: 400 });

  const headers = dojahHeaders(dojahAppId, dojahSecret);
  const since = new Date(Date.now() - 24 * 60 * 60 * 1000).toISOString();

  try {
    const { count: priorAttempts, error: countErr } = await supabase
      .from("kyc_l2_attempts")
      .select("id", { count: "exact", head: true })
      .eq("user_id", userRow.id)
      .gte("created_at", since);
    if (countErr) throw countErr;
    if ((priorAttempts ?? 0) >= 5) {
      return withCors({ error: "Maximum 5 verification attempts per 24 hours. Try again later." }, { status: 429 });
    }

    const { error: attErr } = await supabase.from("kyc_l2_attempts").insert({ user_id: userRow.id });
    if (attErr) throw attErr;

    const bvnUrl = new URL("https://api.dojah.io/api/v1/kyc/bvn");
    bvnUrl.searchParams.set("bvn", bvn);
    const bvnRes = await fetch(bvnUrl.toString(), { headers });
    const bvnRaw = await bvnRes.json();
    if (!bvnRes.ok) {
      const msg = typeof bvnRaw?.message === "string" ? bvnRaw.message : `Dojah BVN error (${bvnRes.status})`;
      return withCors({ error: "BVN verification failed", detail: msg }, { status: 400 });
    }

    const bvnEntity = bvnRaw?.entity ?? bvnRaw?.data ?? {};
    const bvnFirstName = (bvnEntity.first_name ?? bvnEntity.firstName ?? "").trim();
    const bvnLastName = (bvnEntity.last_name ?? bvnEntity.lastName ?? "").trim();
    const bvnMiddleName = (bvnEntity.middle_name ?? bvnEntity.middleName ?? "").trim();
    const verifiedFullName = [bvnFirstName, bvnMiddleName, bvnLastName].filter(Boolean).join(" ");

    if (!bvnFirstName || !bvnLastName) {
      return withCors({ error: "BVN verification returned incomplete name data" }, { status: 400 });
    }

    const ninUrl = new URL("https://api.dojah.io/api/v1/kyc/nin");
    ninUrl.searchParams.set("nin", nin);
    const ninRes = await fetch(ninUrl.toString(), { headers });
    const ninRaw = await ninRes.json();
    if (!ninRes.ok) {
      const msg = typeof ninRaw?.message === "string" ? ninRaw.message : `Dojah NIN error (${ninRes.status})`;
      return withCors({ error: "NIN verification failed", detail: msg }, { status: 400 });
    }

    const ninEntity = ninRaw?.entity ?? ninRaw?.data ?? {};
    const ninFirstName = (ninEntity.first_name ?? ninEntity.firstName ?? "").trim();
    const ninLastName = (ninEntity.last_name ?? ninEntity.lastName ?? "").trim();
    const ninMiddleName = (ninEntity.middle_name ?? ninEntity.middleName ?? "").trim();
    const ninFullName = [ninFirstName, ninMiddleName, ninLastName].filter(Boolean).join(" ");

    if (!surnamesCompatible(verifiedFullName, ninFullName || verifiedFullName)) {
      return withCors({
        error: "BVN and NIN identity details do not match. Check the numbers and try again.",
      }, { status: 400 });
    }

    const { data: existingVa } = await supabase
      .from("monnify_reserved_accounts")
      .select("id")
      .eq("user_id", userRow.id)
      .maybeSingle();

    let monnifyPayload: Awaited<ReturnType<typeof createReservedAccount>> | null = null;

    if (!existingVa) {
      try {
        monnifyPayload = await createReservedAccount({
          userId: userRow.id,
          userName: verifiedFullName || userRow.full_name || "Doings User",
          email: userRow.email || "",
          bvn,
          nin,
        });
      } catch (e) {
        return withCors({
          error: "Identity verified, but we could not create your bank transfer account. Try again shortly or contact support.",
          detail: String(e),
        }, { status: 502 });
      }
    }

    const bvnHash = await sha256Hex(bvn);
    const ninHash = await sha256Hex(nin);
    const { error: kycInsErr } = await supabase.from("kyc_verifications").insert({
      user_id: userRow.id,
      level: 2,
      status: "verified",
      provider: "dojah",
      bvn_hash: bvnHash,
      bvn_last_four: bvn.slice(-4),
      bvn_first_name: bvnFirstName,
      bvn_last_name: bvnLastName,
      bvn_dob: bvnEntity.date_of_birth ?? bvnEntity.dateOfBirth ?? body.dateOfBirth ?? null,
      nin_hash: ninHash,
      nin_last_four: nin.slice(-4),
      raw_response: { bvn: bvnRaw, nin: ninRaw },
      verified_at: new Date().toISOString(),
    });
    if (kycInsErr) throw kycInsErr;

    await supabase.from("users").update({ full_name: verifiedFullName }).eq("id", userRow.id);

    if (monnifyPayload) {
      const { data: ngnWallet } = await supabase
        .from("wallets")
        .select("id")
        .eq("user_id", userRow.id)
        .eq("currency", "NGN")
        .single();

      if (!ngnWallet) {
        return withCors({ error: "NGN wallet missing; contact support" }, { status: 500 });
      }

      const { error: monInsErr } = await supabase.from("monnify_reserved_accounts").insert({
        user_id: userRow.id,
        wallet_id: ngnWallet.id,
        account_reference: monnifyPayload.accountReference,
        account_name: monnifyPayload.accountName,
        account_number: monnifyPayload.accountNumber,
        bank_name: monnifyPayload.bankName,
        bank_code: monnifyPayload.bankCode,
        reservation_reference: monnifyPayload.reservationReference,
      });
      if (monInsErr) throw monInsErr;
    }

    return withCors({
      ok: true,
      level: 2,
      verified_name: verifiedFullName,
      reserved_account: monnifyPayload
        ? {
            accountNumber: monnifyPayload.accountNumber,
            bankName: monnifyPayload.bankName,
            accountName: monnifyPayload.accountName,
          }
        : undefined,
    });
  } catch (error) {
    return withCors({ error: "KYC verification failed", detail: String(error) }, { status: 500 });
  }
});
