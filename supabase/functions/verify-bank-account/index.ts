import { corsHeaders, withCors } from "../_shared/cors.ts";
import { getAuthUserIdFromRequest, getServiceClient } from "../_shared/db.ts";
import { checkRateLimit, RATE_LIMITS } from "../_shared/rate-limit.ts";
import { getPlatformPaymentSettings } from "../_shared/psp/platformSettings.ts";
import { verifyBankAccount } from "../_shared/psp/registry.ts";

Deno.serve(async (req) => {
  if (req.method === "OPTIONS") return new Response("ok", { headers: corsHeaders });
  if (req.method !== "POST") return withCors({ error: "Method not allowed" }, { status: 405 });

  const authHeader = req.headers.get("Authorization");
  if (!authHeader) return withCors({ error: "Missing authorization" }, { status: 401 });

  const authUserId = await getAuthUserIdFromRequest(authHeader);
  if (!authUserId) return withCors({ error: "Unauthorized" }, { status: 401 });

  // Each call is a paid name enquiry at the provider and turns an account number into a name.
  const rl = await checkRateLimit(RATE_LIMITS.bankVerify(authUserId));
  if (!rl.allowed) return withCors({ error: "Too many checks. Try again shortly." }, { status: 429 });

  const body = await req.json().catch(() => ({})) as Record<string, unknown>;
  const bankCode = typeof body.bank_code === "string" ? body.bank_code.trim() : "";
  const accountNumber = typeof body.account_number === "string" ? body.account_number.trim() : "";

  if (!bankCode || !accountNumber) {
    return withCors({ error: "bank_code and account_number are required" }, { status: 400 });
  }
  // The code goes into the provider's URL: letters and digits only.
  if (!/^[A-Za-z0-9]{2,12}$/.test(bankCode)) {
    return withCors({ error: "bank_code is not valid" }, { status: 400 });
  }
  if (!/^\d{10}$/.test(accountNumber)) {
    return withCors({ error: "account_number must be exactly 10 digits" }, { status: 400 });
  }

  const supabase = getServiceClient();
  let platform;
  try {
    platform = await getPlatformPaymentSettings(supabase);
  } catch {
    return withCors({ error: "Payment provider not configured" }, { status: 500 });
  }

  try {
    const result = await verifyBankAccount(
      platform.disbursementProviderId,
      bankCode,
      accountNumber,
      platform.pspEnv,
    );
    return withCors({
      ok: true,
      bank_code: bankCode,
      account_number: accountNumber,
      account_name: result.accountName,
      provider: platform.disbursementProviderId,
    });
  } catch (err) {
    console.error("verify-bank-account failed", err instanceof Error ? err.message : String(err));
    return withCors({ error: "Bank verification failed" }, { status: 502 });
  }
});
