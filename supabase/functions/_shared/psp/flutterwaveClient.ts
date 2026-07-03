const REQUEST_TIMEOUT_MS = 20_000;
const DEFAULT_BASE = "https://api.flutterwave.com/v3";

export function flutterwaveBaseUrl(): string {
  return (Deno.env.get("FLUTTERWAVE_API_BASE") || DEFAULT_BASE).replace(/\/$/, "");
}

export function getFlutterwaveSecretKey(): string {
  const key = Deno.env.get("FLUTTERWAVE_SECRET_KEY")?.trim();
  if (!key) throw new Error("FLUTTERWAVE_SECRET_KEY not configured");
  return key;
}

export function getFlutterwaveSetupStatus(): {
  configured: boolean;
  hasSecretKey: boolean;
  hasWebhookHash: boolean;
} {
  const hasSecretKey = Boolean(Deno.env.get("FLUTTERWAVE_SECRET_KEY")?.trim());
  const hasWebhookHash = Boolean(Deno.env.get("FLUTTERWAVE_WEBHOOK_SECRET_HASH")?.trim());
  return { configured: hasSecretKey, hasSecretKey, hasWebhookHash };
}

export function splitPersonName(fullName: string): { firstName: string; lastName: string } {
  const parts = fullName.trim().split(/\s+/).filter(Boolean);
  if (parts.length === 0) return { firstName: "Doings", lastName: "User" };
  if (parts.length === 1) return { firstName: parts[0], lastName: parts[0] };
  return { firstName: parts[0], lastName: parts.slice(1).join(" ") };
}

export async function flutterwaveApiRequest<T = unknown>(input: {
  method: string;
  path: string;
  body?: Record<string, unknown>;
}): Promise<{ ok: boolean; status: number; json: T }> {
  const secret = getFlutterwaveSecretKey();
  const url = `${flutterwaveBaseUrl()}${input.path.startsWith("/") ? input.path : `/${input.path}`}`;
  const ctrl = new AbortController();
  const t = setTimeout(() => ctrl.abort(), REQUEST_TIMEOUT_MS);
  try {
    const res = await fetch(url, {
      method: input.method,
      headers: {
        Authorization: `Bearer ${secret}`,
        "Content-Type": "application/json",
      },
      body: input.body ? JSON.stringify(input.body) : undefined,
      signal: ctrl.signal,
    });
    const json = await res.json().catch(() => ({})) as T;
    return { ok: res.ok, status: res.status, json };
  } finally {
    clearTimeout(t);
  }
}

export async function flutterwaveListBanks(): Promise<Array<{ code: string; name: string }>> {
  const { ok, json } = await flutterwaveApiRequest({
    method: "GET",
    path: "/banks/NG",
  });

  const rows = (json as { data?: Array<{ code?: string; name?: string }> }).data ?? [];
  if (!ok) {
    throw new Error(String((json as { message?: string }).message || "Flutterwave bank list failed"));
  }

  return rows
    .map((row) => ({
      code: String(row.code ?? "").trim(),
      name: String(row.name ?? "").trim(),
    }))
    .filter((row) => row.code && row.name);
}

export async function flutterwaveResolveBankAccount(input: {
  bankCode: string;
  accountNumber: string;
}): Promise<{ ok: true; accountName: string } | { ok: false; message: string; raw?: unknown }> {
  const { ok, json } = await flutterwaveApiRequest({
    method: "POST",
    path: "/accounts/resolve",
    body: {
      account_number: input.accountNumber,
      account_bank: input.bankCode,
    },
  });

  const data = (json as { data?: { account_name?: string } }).data;
  const name = String(data?.account_name || "").trim();
  if (ok && name) return { ok: true, accountName: name };
  return {
    ok: false,
    message: String((json as { message?: string }).message || "Flutterwave account lookup failed"),
    raw: json,
  };
}

export async function flutterwaveCreateVirtualAccount(input: {
  txRef: string;
  email: string;
  userName: string;
  bvn: string;
  phoneNumber?: string;
}): Promise<{
  accountReference: string;
  accountNumber: string;
  accountName: string;
  bankName: string;
  bankCode: string;
  raw: unknown;
}> {
  const bvn = input.bvn.replace(/\D/g, "");
  if (bvn.length !== 11) throw new Error("Valid 11-digit BVN is required for Flutterwave virtual accounts");

  const { firstName, lastName } = splitPersonName(input.userName);
  const phone = (input.phoneNumber || Deno.env.get("FLUTTERWAVE_DEFAULT_PHONE") || "08000000000").replace(/\D/g, "")
    .slice(0, 11);

  const { ok, json } = await flutterwaveApiRequest({
    method: "POST",
    path: "/virtual-account-numbers",
    body: {
      email: input.email || `user+${input.txRef}@doings.app`,
      amount: 100,
      tx_ref: input.txRef,
      phonenumber: phone,
      firstname: firstName.slice(0, 50),
      lastname: lastName.slice(0, 50),
      narration: "Doings wallet funding",
      is_permanent: true,
      bvn,
    },
  });

  const data = (json as {
    data?: {
      account_number?: string;
      bank_name?: string;
      flw_ref?: string;
      order_ref?: string;
      note?: string;
    };
    message?: string;
  }).data;

  if (!ok || !data?.account_number) {
    throw new Error(String((json as { message?: string }).message || "Flutterwave virtual account creation failed"));
  }

  const accountName = `${firstName} ${lastName}`.trim();
  return {
    accountReference: input.txRef,
    accountNumber: String(data.account_number),
    accountName,
    bankName: String(data.bank_name || "Flutterwave"),
    bankCode: "",
    raw: json,
  };
}
