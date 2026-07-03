import { mapMonnifyStatus } from "./pspStatus.ts";
import type { PspEnv } from "./types.ts";

const REQUEST_TIMEOUT_MS = 15_000;

function monnifyBase(env: PspEnv): string {
  if (env === "production") {
    return Deno.env.get("MONNIFY_API_BASE_PROD") || "https://api.monnify.com";
  }
  return Deno.env.get("MONNIFY_API_BASE_SANDBOX") || Deno.env.get("MONNIFY_BASE_URL") || "https://sandbox.monnify.com";
}

function disbursementSourceAccount(): string {
  return (
    Deno.env.get("MONNIFY_DISBURSEMENT_SOURCE_ACCOUNT") ||
    Deno.env.get("MONNIFY_SOURCE_ACCOUNT") ||
    ""
  ).trim();
}

let cachedToken: { token: string; expiresAt: number; env: string } | null = null;

async function getAccessToken(env: PspEnv): Promise<string> {
  const now = Date.now();
  if (cachedToken && cachedToken.env === env && cachedToken.expiresAt > now + 60_000) {
    return cachedToken.token;
  }

  const apiKey = Deno.env.get("MONNIFY_API_KEY");
  const secret = Deno.env.get("MONNIFY_SECRET_KEY");
  if (!apiKey || !secret) throw new Error("Monnify credentials missing");

  const basic = btoa(`${apiKey}:${secret}`);
  const url = `${monnifyBase(env)}/api/v1/auth/login`;
  const ctrl = new AbortController();
  const t = setTimeout(() => ctrl.abort(), REQUEST_TIMEOUT_MS);
  try {
    const res = await fetch(url, {
      method: "POST",
      headers: { Authorization: `Basic ${basic}` },
      signal: ctrl.signal,
    });
    const body = await res.json().catch(() => ({})) as {
      requestSuccessful?: boolean;
      responseBody?: { accessToken?: string; expiresIn?: number };
    };
    if (!body?.requestSuccessful || !body?.responseBody?.accessToken) {
      throw new Error("Monnify auth failed");
    }
    cachedToken = {
      token: body.responseBody.accessToken,
      expiresAt: now + (body.responseBody.expiresIn || 3600) * 1000,
      env,
    };
    return cachedToken.token;
  } finally {
    clearTimeout(t);
  }
}

export async function monnifyListBanks(env: PspEnv): Promise<Array<{ code: string; name: string }>> {
  const token = await getAccessToken(env);
  const url = `${monnifyBase(env)}/api/v1/banks`;
  const ctrl = new AbortController();
  const t = setTimeout(() => ctrl.abort(), REQUEST_TIMEOUT_MS);
  try {
    const res = await fetch(url, {
      headers: { Authorization: `Bearer ${token}` },
      signal: ctrl.signal,
    });
    const body = await res.json().catch(() => ({})) as {
      requestSuccessful?: boolean;
      responseBody?: Array<{ name?: string; code?: string }>;
    };
    if (!res.ok || !body.requestSuccessful) {
      throw new Error(String((body as { responseMessage?: string }).responseMessage || "Monnify bank list failed"));
    }
    return (body.responseBody ?? [])
      .map((row) => ({
        code: String(row.code ?? "").trim(),
        name: String(row.name ?? "").trim(),
      }))
      .filter((row) => row.code && row.name);
  } finally {
    clearTimeout(t);
  }
}

export async function monnifyValidateBankAccount(input: {
  env: PspEnv;
  bankCode: string;
  accountNumber: string;
}): Promise<{ ok: true; accountName: string } | { ok: false; message: string }> {
  let token: string;
  try {
    token = await getAccessToken(input.env);
  } catch (e) {
    return { ok: false, message: e instanceof Error ? e.message : "auth failed" };
  }

  const q = new URLSearchParams({
    accountNumber: input.accountNumber,
    bankCode: input.bankCode,
  });
  const url = `${monnifyBase(input.env)}/api/v1/disbursements/account/validate?${q}`;
  const ctrl = new AbortController();
  const t = setTimeout(() => ctrl.abort(), REQUEST_TIMEOUT_MS);
  try {
    const res = await fetch(url, {
      headers: { Authorization: `Bearer ${token}` },
      signal: ctrl.signal,
    });
    const body = await res.json().catch(() => ({}));
    const name = String((body as { responseBody?: { accountName?: string } }).responseBody?.accountName || "").trim();
    if (res.ok && name) return { ok: true, accountName: name };
    return {
      ok: false,
      message: String((body as { responseMessage?: string }).responseMessage || "Name enquiry failed"),
    };
  } catch (e) {
    return { ok: false, message: e instanceof Error ? e.message : "network error" };
  } finally {
    clearTimeout(t);
  }
}

export type MonnifySubmitOutcome =
  | { kind: "accepted"; providerRef: string | null; providerStatus: string; rawBody: unknown }
  | { kind: "rejected_terminal"; providerStatus: string; message: string; rawBody: unknown }
  | { kind: "non_terminal"; providerRef: string | null; providerStatus: string; rawBody: unknown }
  | { kind: "unknown"; message: string; rawBody: unknown };

export async function monnifySubmitTransfer(input: {
  env: PspEnv;
  reference: string;
  amountNaira: number;
  destinationBankCode: string;
  destinationAccountNumber: string;
  destinationAccountName?: string;
  narration: string;
}): Promise<MonnifySubmitOutcome> {
  const sourceAccount = disbursementSourceAccount();
  if (!sourceAccount) {
    return {
      kind: "rejected_terminal",
      providerStatus: "CONFIG_ERROR",
      message: "MONNIFY_DISBURSEMENT_SOURCE_ACCOUNT or MONNIFY_SOURCE_ACCOUNT not configured",
      rawBody: {},
    };
  }

  let token: string;
  try {
    token = await getAccessToken(input.env);
  } catch (e) {
    return { kind: "unknown", message: e instanceof Error ? e.message : "auth failed", rawBody: {} };
  }

  let destinationAccountName = String(input.destinationAccountName || "").trim();
  if (!destinationAccountName) {
    const enquiry = await monnifyValidateBankAccount({
      env: input.env,
      bankCode: input.destinationBankCode,
      accountNumber: input.destinationAccountNumber,
    });
    if (!enquiry.ok) {
      return {
        kind: "rejected_terminal",
        providerStatus: "NAME_ENQUIRY_FAILED",
        message: enquiry.message,
        rawBody: {},
      };
    }
    destinationAccountName = enquiry.accountName;
  }

  const url = `${monnifyBase(input.env)}/api/v2/disbursements/single`;
  const ctrl = new AbortController();
  const t = setTimeout(() => ctrl.abort(), REQUEST_TIMEOUT_MS);
  try {
    const res = await fetch(url, {
      method: "POST",
      headers: { Authorization: `Bearer ${token}`, "Content-Type": "application/json" },
      body: JSON.stringify({
        amount: input.amountNaira,
        reference: input.reference,
        narration: input.narration.slice(0, 80),
        destinationBankCode: input.destinationBankCode,
        destinationAccountNumber: input.destinationAccountNumber,
        destinationAccountName,
        currency: "NGN",
        sourceAccountNumber: sourceAccount,
      }),
      signal: ctrl.signal,
    });
    const body = await res.json().catch(() => ({}));
    const envelope = body as {
      requestSuccessful?: boolean;
      responseMessage?: string;
      responseBody?: { status?: string; transactionReference?: string; reference?: string };
    };

    if (envelope.requestSuccessful === false) {
      return {
        kind: "rejected_terminal",
        providerStatus: String(envelope.responseMessage || "MONNIFY_REQUEST_FAILED"),
        message: String(envelope.responseMessage || "Monnify rejected the disbursement request"),
        rawBody: body,
      };
    }

    const rb = envelope.responseBody;
    const providerStatus = String(rb?.status || "");
    const providerRef = rb?.transactionReference || rb?.reference || null;
    const mapped = mapMonnifyStatus(providerStatus);

    if (mapped.cls === "terminal_success") {
      return { kind: "accepted", providerRef, providerStatus, rawBody: body };
    }
    if (mapped.cls === "terminal_failure") {
      return {
        kind: "rejected_terminal",
        providerStatus,
        message: providerStatus || "Transfer failed",
        rawBody: body,
      };
    }
    return { kind: "non_terminal", providerRef, providerStatus, rawBody: body };
  } catch (e) {
    return { kind: "unknown", message: e instanceof Error ? e.message : "network error", rawBody: {} };
  } finally {
    clearTimeout(t);
  }
}

export type MonnifyStatusOutcome =
  | { kind: "terminal_success"; providerStatus: string; rawBody: unknown }
  | { kind: "terminal_failure"; providerStatus: string; rawBody: unknown }
  | { kind: "non_terminal"; providerStatus: string; rawBody: unknown; unmapped?: boolean }
  | { kind: "unknown"; message: string; rawBody: unknown };

export async function monnifyFetchTransferStatus(input: {
  env: PspEnv;
  reference: string;
}): Promise<MonnifyStatusOutcome> {
  let token: string;
  try {
    token = await getAccessToken(input.env);
  } catch (e) {
    return { kind: "unknown", message: e instanceof Error ? e.message : "auth failed", rawBody: {} };
  }

  const url = `${monnifyBase(input.env)}/api/v2/disbursements/single/summary?reference=${encodeURIComponent(input.reference)}`;
  const ctrl = new AbortController();
  const t = setTimeout(() => ctrl.abort(), REQUEST_TIMEOUT_MS);
  try {
    const res = await fetch(url, {
      headers: { Authorization: `Bearer ${token}` },
      signal: ctrl.signal,
    });
    const body = await res.json().catch(() => ({}));
    const providerStatus = String(
      (body as { responseBody?: { status?: string } }).responseBody?.status || "",
    );

    if (!res.ok) {
      return { kind: "unknown", message: `HTTP ${res.status}`, rawBody: body };
    }

    const mapped = mapMonnifyStatus(providerStatus);
    if (mapped.cls === "terminal_success") {
      return { kind: "terminal_success", providerStatus, rawBody: body };
    }
    if (mapped.cls === "terminal_failure") {
      return { kind: "terminal_failure", providerStatus, rawBody: body };
    }
    return { kind: "non_terminal", providerStatus, rawBody: body, unmapped: mapped.unmapped };
  } catch (e) {
    return { kind: "unknown", message: e instanceof Error ? e.message : "network error", rawBody: {} };
  } finally {
    clearTimeout(t);
  }
}
