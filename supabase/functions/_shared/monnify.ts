const MONNIFY_BASE_URL = Deno.env.get("MONNIFY_BASE_URL") ?? "https://sandbox.monnify.com";
const MONNIFY_API_KEY = Deno.env.get("MONNIFY_API_KEY") ?? "";
const MONNIFY_SECRET_KEY = Deno.env.get("MONNIFY_SECRET_KEY") ?? "";
const MONNIFY_CONTRACT_CODE = Deno.env.get("MONNIFY_CONTRACT_CODE") ?? "";

let cachedToken: { token: string; expiresAt: number } | null = null;

export async function getMonnifyToken(): Promise<string> {
  if (cachedToken && Date.now() < cachedToken.expiresAt) return cachedToken.token;

  const credentials = btoa(`${MONNIFY_API_KEY}:${MONNIFY_SECRET_KEY}`);
  const res = await fetch(`${MONNIFY_BASE_URL}/api/v1/auth/login`, {
    method: "POST",
    headers: { Authorization: `Basic ${credentials}` },
  });

  if (!res.ok) throw new Error(`Monnify auth failed: ${res.status}`);
  const body = await res.json();
  const token = body.responseBody?.accessToken;
  if (!token) throw new Error("Monnify auth returned no token");

  cachedToken = { token, expiresAt: Date.now() + 4 * 60 * 1000 };
  return token;
}

export async function createReservedAccount(params: {
  userId: string;
  userName: string;
  email: string;
  bvn: string;
}): Promise<{
  accountNumber: string;
  accountName: string;
  bankName: string;
  bankCode: string;
  accountReference: string;
  reservationReference: string;
}> {
  const token = await getMonnifyToken();
  const accountReference = `DOINGS-${params.userId}`;

  const res = await fetch(`${MONNIFY_BASE_URL}/api/v2/bank-transfer/reserved-accounts`, {
    method: "POST",
    headers: {
      Authorization: `Bearer ${token}`,
      "Content-Type": "application/json",
    },
    body: JSON.stringify({
      accountReference,
      accountName: `DOINGS/${params.userName}`,
      currencyCode: "NGN",
      contractCode: MONNIFY_CONTRACT_CODE,
      customerEmail: params.email || `${params.userId}@doings.app`,
      customerName: params.userName || "Doings User",
      bvn: params.bvn,
      getAllAvailableBanks: false,
      preferredBanks: ["035"],
      restrictPaymentSource: true,
    }),
  });

  if (!res.ok) {
    const errBody = await res.text();
    throw new Error(`Monnify reserved account creation failed: ${res.status} — ${errBody}`);
  }

  const body = await res.json();
  const acct = body.responseBody?.accounts?.[0] ?? body.responseBody;

  return {
    accountNumber: acct.accountNumber,
    accountName: acct.accountName,
    bankName: acct.bankName,
    bankCode: acct.bankCode,
    accountReference,
    reservationReference: body.responseBody?.reservationReference ?? "",
  };
}

export async function verifyBankAccount(bankCode: string, accountNumber: string): Promise<{ accountName: string }> {
  const token = await getMonnifyToken();
  const res = await fetch(
    `${MONNIFY_BASE_URL}/api/v1/disbursements/account/validate?accountNumber=${accountNumber}&bankCode=${bankCode}`,
    { headers: { Authorization: `Bearer ${token}` } },
  );
  if (!res.ok) throw new Error(`Bank verification failed: ${res.status}`);
  const body = await res.json();
  return { accountName: body.responseBody?.accountName ?? "" };
}

export async function disburseFunds(params: {
  amount: number;
  reference: string;
  narration: string;
  destinationBankCode: string;
  destinationAccountNumber: string;
  destinationAccountName: string;
}): Promise<{
  transactionReference: string;
  status: string;
}> {
  const token = await getMonnifyToken();
  const res = await fetch(`${MONNIFY_BASE_URL}/api/v2/disbursements/single`, {
    method: "POST",
    headers: {
      Authorization: `Bearer ${token}`,
      "Content-Type": "application/json",
    },
    body: JSON.stringify({
      amount: params.amount,
      reference: params.reference,
      narration: params.narration,
      destinationBankCode: params.destinationBankCode,
      destinationAccountNumber: params.destinationAccountNumber,
      destinationAccountName: params.destinationAccountName,
      currency: "NGN",
      sourceAccountNumber: Deno.env.get("MONNIFY_SOURCE_ACCOUNT") ?? "",
    }),
  });

  if (!res.ok) {
    const errBody = await res.text();
    throw new Error(`Monnify disbursement failed: ${res.status} — ${errBody}`);
  }

  const body = await res.json();
  const txn = body.responseBody ?? {};
  return {
    transactionReference: txn.transactionReference ?? txn.reference ?? params.reference,
    status: txn.status ?? "PENDING",
  };
}
