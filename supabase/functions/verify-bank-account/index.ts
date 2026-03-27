import { corsHeaders, withCors } from "../_shared/cors.ts";
import { getAuthedClient } from "../_shared/db.ts";
import { verifyBankAccount } from "../_shared/monnify.ts";

Deno.serve(async (req) => {
  if (req.method === "OPTIONS") return new Response("ok", { headers: corsHeaders });
  if (req.method !== "POST") return withCors({ error: "Method not allowed" }, { status: 405 });

  const authHeader = req.headers.get("Authorization");
  if (!authHeader) return withCors({ error: "Missing authorization" }, { status: 401 });

  const authedClient = getAuthedClient(authHeader);
  const { data: authData, error: authError } = await authedClient.auth.getUser();
  if (authError || !authData.user) return withCors({ error: "Unauthorized" }, { status: 401 });

  const body = await req.json();
  const bankCode = body.bank_code as string;
  const accountNumber = body.account_number as string;

  if (!bankCode || !accountNumber) {
    return withCors({ error: "bank_code and account_number are required" }, { status: 400 });
  }
  if (!/^\d{10}$/.test(accountNumber)) {
    return withCors({ error: "account_number must be exactly 10 digits" }, { status: 400 });
  }

  try {
    const result = await verifyBankAccount(bankCode, accountNumber);
    return withCors({
      ok: true,
      bank_code: bankCode,
      account_number: accountNumber,
      account_name: result.accountName,
    });
  } catch (err) {
    return withCors({ error: "Bank verification failed", detail: String(err) }, { status: 502 });
  }
});
