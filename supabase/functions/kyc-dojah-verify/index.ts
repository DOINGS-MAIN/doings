import { corsHeaders, withCors } from "../_shared/cors.ts";
import { sha256Hex } from "../_shared/crypto.ts";
import { getAuthUserIdFromRequest, getServiceClient } from "../_shared/db.ts";
import {
  dojahGetJson,
  dojahHeaders,
  parseDojahIdentityEntity,
} from "../_shared/dojahClient.ts";
import { getPlatformPaymentSettings } from "../_shared/psp/platformSettings.ts";
import {
  getExistingReservedAccount,
  provisionReservedAccount,
  type ReservedAccountRow,
} from "../_shared/psp/provisionReservedAccount.ts";

type VerifyBody = {
  bvn?: string;
  nin?: string;
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

function formatReservedAccount(account: ReservedAccountRow) {
  return {
    accountNumber: account.accountNumber,
    bankName: account.bankName,
    accountName: account.accountName,
    provider: account.providerId,
  };
}

async function tryProvisionFundingAccount(
  supabase: ReturnType<typeof getServiceClient>,
  input: {
    userId: string;
    userName: string;
    email: string;
    walletId: string;
    bvn?: string;
    nin?: string;
    providerId: string;
  },
): Promise<ReservedAccountRow | null> {
  const existing = await getExistingReservedAccount(supabase, input.userId, input.providerId);
  if (existing) return existing;

  return await provisionReservedAccount(supabase, {
    userId: input.userId,
    userName: input.userName,
    email: input.email,
    walletId: input.walletId,
    bvn: input.bvn,
    nin: input.nin,
    providerId: input.providerId,
  });
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

  if (userRow.kyc_level < 1) {
    return withCors({ error: "Verify your email before completing BVN and NIN" }, { status: 403 });
  }

  const body = (await req.json()) as VerifyBody;
  const bvn = cleanDigits(body.bvn);
  const nin = cleanDigits(body.nin);

  const platform = await getPlatformPaymentSettings(supabase);
  const fundingProviderId = platform.walletFundingProviderId;
  const needsBvnForVa = fundingProviderId === "monnify" || fundingProviderId === "flutterwave";

  // Already L2 — skip Dojah; only provision VA if missing (e.g. prior VA failure).
  if (userRow.kyc_level >= 2) {
    const existingVa = await getExistingReservedAccount(supabase, userRow.id, fundingProviderId);
    if (existingVa) {
      return withCors({
        ok: true,
        already_verified: true,
        level: 2,
        verified_name: userRow.full_name,
        funding_provider: fundingProviderId,
        reserved_account: formatReservedAccount(existingVa),
      });
    }

    if (needsBvnForVa && bvn.length !== 11) {
      return withCors({
        error: "Your identity is already verified. Enter your BVN to create your transfer account.",
        code: "bvn_required_for_va",
      }, { status: 400 });
    }

    const { data: ngnWallet } = await supabase
      .from("wallets")
      .select("id")
      .eq("user_id", userRow.id)
      .eq("currency", "NGN")
      .single();

    if (!ngnWallet) {
      return withCors({ error: "NGN wallet missing; contact support" }, { status: 500 });
    }

    try {
      const reservedAccount = await tryProvisionFundingAccount(supabase, {
        userId: userRow.id,
        userName: userRow.full_name || "Doings User",
        email: userRow.email || "",
        walletId: ngnWallet.id,
        bvn: bvn || undefined,
        nin: nin || undefined,
        providerId: fundingProviderId,
      });

      return withCors({
        ok: true,
        already_verified: true,
        level: 2,
        verified_name: userRow.full_name,
        funding_provider: fundingProviderId,
        reserved_account: reservedAccount ? formatReservedAccount(reservedAccount) : undefined,
      });
    } catch (e) {
      return withCors({
        error: "Could not create your bank transfer account. Try Fund Wallet or contact support.",
        detail: String(e),
        code: "va_provision_failed",
      }, { status: 502 });
    }
  }

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

    const { res: bvnRes, json: bvnRaw } = await dojahGetJson("/api/v1/kyc/bvn/full", { bvn }, headers);
    if (!bvnRes.ok) {
      const msg = typeof bvnRaw?.message === "string"
        ? bvnRaw.message
        : typeof bvnRaw?.error === "string"
        ? bvnRaw.error
        : `Dojah BVN error (${bvnRes.status})`;
      return withCors({ error: "BVN verification failed", detail: msg }, { status: 400 });
    }

    const bvnIdentity = parseDojahIdentityEntity(bvnRaw);
    const {
      firstName: bvnFirstName,
      lastName: bvnLastName,
      fullName: verifiedFullName,
      dateOfBirth: bvnDob,
    } = bvnIdentity;

    if (!bvnFirstName || !bvnLastName) {
      return withCors({
        error: "BVN verification returned incomplete name data",
        detail: "Dojah did not return first and last name for this BVN. Ensure BVN lookup/full is enabled on your Dojah plan.",
      }, { status: 400 });
    }

    const { res: ninRes, json: ninRaw } = await dojahGetJson("/api/v1/kyc/nin", { nin }, headers);
    if (!ninRes.ok) {
      const msg = typeof ninRaw?.message === "string"
        ? ninRaw.message
        : typeof ninRaw?.error === "string"
        ? ninRaw.error
        : `Dojah NIN error (${ninRes.status})`;
      return withCors({ error: "NIN verification failed", detail: msg }, { status: 400 });
    }

    const ninIdentity = parseDojahIdentityEntity(ninRaw);
    const ninFullName = ninIdentity.fullName;

    if (!surnamesCompatible(verifiedFullName, ninFullName || verifiedFullName)) {
      return withCors({
        error: "BVN and NIN identity details do not match. Check the numbers and try again.",
      }, { status: 400 });
    }

    // Persist KYC before VA provisioning so a PSP failure does not force re-verification.
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
      bvn_dob: bvnDob ?? body.dateOfBirth ?? null,
      nin_hash: ninHash,
      nin_last_four: nin.slice(-4),
      raw_response: { bvn: bvnRaw, nin: ninRaw },
      verified_at: new Date().toISOString(),
    });
    if (kycInsErr) throw kycInsErr;

    await supabase.from("users").update({ full_name: verifiedFullName }).eq("id", userRow.id);

    const { data: ngnWallet } = await supabase
      .from("wallets")
      .select("id")
      .eq("user_id", userRow.id)
      .eq("currency", "NGN")
      .single();

    if (!ngnWallet) {
      return withCors({
        ok: true,
        level: 2,
        verified_name: verifiedFullName,
        funding_provider: fundingProviderId,
        va_pending: true,
        message: "Identity verified. NGN wallet missing — contact support to finish transfer account setup.",
      });
    }

    let reservedAccount: ReservedAccountRow | null = null;
    let vaError: string | undefined;

    try {
      reservedAccount = await tryProvisionFundingAccount(supabase, {
        userId: userRow.id,
        userName: verifiedFullName || userRow.full_name || "Doings User",
        email: userRow.email || "",
        walletId: ngnWallet.id,
        bvn,
        nin,
        providerId: fundingProviderId,
      });
    } catch (e) {
      vaError = String(e);
    }

    if (vaError) {
      return withCors({
        ok: true,
        level: 2,
        verified_name: verifiedFullName,
        funding_provider: fundingProviderId,
        va_pending: true,
        va_error: vaError,
        message: "Identity verified. Transfer account setup failed — open Fund Wallet to retry with your BVN.",
      });
    }

    return withCors({
      ok: true,
      level: 2,
      verified_name: verifiedFullName,
      funding_provider: fundingProviderId,
      reserved_account: reservedAccount ? formatReservedAccount(reservedAccount) : undefined,
    });
  } catch (error) {
    return withCors({ error: "KYC verification failed", detail: String(error) }, { status: 500 });
  }
});
