/**
 * Nomba API client — OAuth token + request helpers.
 * Docs: https://developer.nomba.com/docs/getting-started/authentication
 */

const REQUEST_TIMEOUT_MS = 15_000;

export type NombaEnv = "sandbox" | "production";

export function nombaBaseUrl(env: NombaEnv): string {
  if (env === "production") {
    return Deno.env.get("NOMBA_API_BASE_PROD") || "https://api.nomba.com";
  }
  return Deno.env.get("NOMBA_API_BASE_SANDBOX") || "https://sandbox.nomba.com";
}

export function resolveNombaEnv(pspEnv: "sandbox" | "production"): NombaEnv {
  if (Deno.env.get("NOMBA_SANDBOX") === "true") return "sandbox";
  if (Deno.env.get("NOMBA_SANDBOX") === "false") return "production";
  return pspEnv;
}

export function getNombaSetupStatus(): {
  configured: boolean;
  hasClientId: boolean;
  hasClientSecret: boolean;
  hasAccountId: boolean;
} {
  const hasClientId = Boolean(Deno.env.get("NOMBA_CLIENT_ID")?.trim());
  const hasClientSecret = Boolean(Deno.env.get("NOMBA_CLIENT_SECRET")?.trim());
  const hasAccountId = Boolean(Deno.env.get("NOMBA_ACCOUNT_ID")?.trim());
  return {
    configured: hasClientId && hasClientSecret && hasAccountId,
    hasClientId,
    hasClientSecret,
    hasAccountId,
  };
}

type TokenCache = { token: string; expiresAt: number; env: NombaEnv };
let cachedToken: TokenCache | null = null;

export async function nombaAccessToken(env: NombaEnv): Promise<string> {
  const now = Date.now();
  if (cachedToken && cachedToken.env === env && cachedToken.expiresAt > now + 60_000) {
    return cachedToken.token;
  }

  const clientId = Deno.env.get("NOMBA_CLIENT_ID");
  const clientSecret = Deno.env.get("NOMBA_CLIENT_SECRET");
  if (!clientId || !clientSecret) throw new Error("Nomba credentials missing");

  const url = `${nombaBaseUrl(env)}/v1/auth/token/issue`;
  const ctrl = new AbortController();
  const t = setTimeout(() => ctrl.abort(), REQUEST_TIMEOUT_MS);
  try {
    const res = await fetch(url, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        grant_type: "client_credentials",
        client_id: clientId,
        client_secret: clientSecret,
      }),
      signal: ctrl.signal,
    });
    const body = await res.json().catch(() => ({})) as {
      data?: { access_token?: string; expires_in?: number };
      access_token?: string;
      expires_in?: number;
    };
    const token = body?.data?.access_token || body?.access_token;
    const expiresIn = body?.data?.expires_in ?? body?.expires_in ?? 3600;
    if (!res.ok || !token) throw new Error("Nomba auth failed");
    cachedToken = { token, expiresAt: now + Number(expiresIn) * 1000, env };
    return token;
  } finally {
    clearTimeout(t);
  }
}

export function nombaAccountIdHeader(): string {
  const id = Deno.env.get("NOMBA_ACCOUNT_ID")?.trim();
  if (!id) throw new Error("NOMBA_ACCOUNT_ID not configured");
  return id;
}

export async function nombaApiRequest<T = unknown>(input: {
  env: NombaEnv;
  method: string;
  path: string;
  body?: Record<string, unknown>;
}): Promise<{ ok: boolean; status: number; json: T }> {
  const token = await nombaAccessToken(input.env);
  const accountId = nombaAccountIdHeader();
  const url = `${nombaBaseUrl(input.env)}${input.path.startsWith("/") ? input.path : `/${input.path}`}`;
  const ctrl = new AbortController();
  const t = setTimeout(() => ctrl.abort(), REQUEST_TIMEOUT_MS);
  try {
    const res = await fetch(url, {
      method: input.method,
      headers: {
        Authorization: `Bearer ${token}`,
        "Content-Type": "application/json",
        accountId,
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

export async function nombaListBanks(env: NombaEnv): Promise<Array<{ code: string; name: string }>> {
  const { ok, json } = await nombaApiRequest({
    env,
    method: "GET",
    path: "/v1/transfers/banks",
  });

  const payload = json as {
    data?: Array<{ code?: string; name?: string }> | { results?: Array<{ code?: string; name?: string }> };
    results?: Array<{ code?: string; name?: string }>;
  };

  let rows: Array<{ code?: string; name?: string }> = [];
  if (Array.isArray(payload.data)) {
    rows = payload.data;
  } else if (payload.data && Array.isArray(payload.data.results)) {
    rows = payload.data.results;
  } else if (Array.isArray(payload.results)) {
    rows = payload.results;
  }

  if (!ok || rows.length === 0) {
    throw new Error(
      String((json as { message?: string; description?: string }).message ||
        (json as { description?: string }).description ||
        "Nomba bank list failed"),
    );
  }

  return rows
    .map((row) => ({
      code: String(row.code ?? "").trim(),
      name: String(row.name ?? "").trim(),
    }))
    .filter((row) => row.code && row.name);
}

export async function nombaBankAccountLookup(input: {
  env: NombaEnv;
  bankCode: string;
  accountNumber: string;
}): Promise<{ ok: true; accountName: string } | { ok: false; message: string; raw?: unknown }> {
  const { ok, json } = await nombaApiRequest({
    env: input.env,
    method: "POST",
    path: "/v1/transfers/bank/lookup",
    body: {
      bankCode: input.bankCode,
      accountNumber: input.accountNumber,
    },
  });
  const data = (json as { data?: { accountName?: string } }).data;
  const name = String(data?.accountName || "").trim();
  if (ok && name) return { ok: true, accountName: name };
  return {
    ok: false,
    message: String((json as { message?: string; description?: string }).message ||
      (json as { description?: string }).description ||
      "Nomba account lookup failed"),
    raw: json,
  };
}

export async function nombaCreateVirtualAccount(input: {
  env: NombaEnv;
  accountRef: string;
  accountName: string;
}): Promise<{
  accountReference: string;
  accountNumber: string;
  accountName: string;
  bankName: string;
  raw: unknown;
}> {
  const { ok, json } = await nombaApiRequest({
    env: input.env,
    method: "POST",
    path: "/v1/accounts/virtual",
    body: {
      accountRef: input.accountRef,
      accountName: input.accountName,
      currency: "NGN",
    },
  });

  const data = (json as {
    data?: {
      bankAccountNumber?: string;
      bankAccountName?: string;
      bankName?: string;
      accountRef?: string;
    };
  }).data;

  if (!ok || !data?.bankAccountNumber) {
    throw new Error(
      String((json as { message?: string }).message || "Nomba virtual account creation failed"),
    );
  }

  return {
    accountReference: String(data.accountRef || input.accountRef),
    accountNumber: String(data.bankAccountNumber),
    accountName: String(data.bankAccountName || input.accountName),
    bankName: String(data.bankName || "Nomba"),
    raw: json,
  };
}
