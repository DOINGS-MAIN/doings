export function dojahBaseUrl(): string {
  if (Deno.env.get("DOJAH_SANDBOX") === "true") return "https://sandbox.dojah.io";
  if (Deno.env.get("DOJAH_SANDBOX") === "false") return "https://api.dojah.io";
  const override = Deno.env.get("DOJAH_API_BASE")?.trim();
  if (override) return override.replace(/\/$/, "");
  return "https://api.dojah.io";
}

export function dojahHeaders(appId: string, secret: string): Record<string, string> {
  return {
    Authorization: secret,
    AppId: appId,
  };
}

function readNameValue(value: unknown): string {
  if (typeof value === "string") return value.trim();
  if (value && typeof value === "object") {
    const obj = value as Record<string, unknown>;
    if (typeof obj.value === "string") return obj.value.trim();
  }
  return "";
}

function splitFullName(fullName: string): { firstName: string; middleName: string; lastName: string } {
  const parts = fullName.trim().split(/\s+/).filter(Boolean);
  if (parts.length === 0) return { firstName: "", middleName: "", lastName: "" };
  if (parts.length === 1) return { firstName: parts[0], middleName: "", lastName: parts[0] };
  if (parts.length === 2) return { firstName: parts[0], middleName: "", lastName: parts[1] };
  return {
    firstName: parts[0],
    middleName: parts.slice(1, -1).join(" "),
    lastName: parts[parts.length - 1],
  };
}

/** Parse Dojah lookup responses (BVN full / NIN) into normalized name fields. */
export function parseDojahIdentityEntity(raw: unknown): {
  entity: Record<string, unknown>;
  firstName: string;
  middleName: string;
  lastName: string;
  fullName: string;
  dateOfBirth: string | null;
} {
  const root = (raw && typeof raw === "object" ? raw : {}) as Record<string, unknown>;
  const entity = (root.entity ?? root.data ?? root) as Record<string, unknown>;

  let firstName = readNameValue(entity.first_name ?? entity.firstName);
  let middleName = readNameValue(entity.middle_name ?? entity.middleName);
  let lastName = readNameValue(entity.last_name ?? entity.lastName);

  const nameOnCard = readNameValue(entity.name_on_card ?? entity.nameOnCard);
  const fullNameField = readNameValue(entity.full_name ?? entity.fullName ?? entity.name);

  if ((!firstName || !lastName) && nameOnCard) {
    const split = splitFullName(nameOnCard);
    firstName = firstName || split.firstName;
    middleName = middleName || split.middleName;
    lastName = lastName || split.lastName;
  }

  if ((!firstName || !lastName) && fullNameField) {
    const split = splitFullName(fullNameField);
    firstName = firstName || split.firstName;
    middleName = middleName || split.middleName;
    lastName = lastName || split.lastName;
  }

  const fullName = [firstName, middleName, lastName].filter(Boolean).join(" ");
  const dob = readNameValue(entity.date_of_birth ?? entity.dateOfBirth ?? entity.dob) || null;

  return { entity, firstName, middleName, lastName, fullName, dateOfBirth: dob };
}

export async function dojahGetJson(path: string, params: Record<string, string>, headers: Record<string, string>) {
  const url = new URL(`${dojahBaseUrl()}${path.startsWith("/") ? path : `/${path}`}`);
  for (const [key, value] of Object.entries(params)) {
    url.searchParams.set(key, value);
  }
  const res = await fetch(url.toString(), { headers });
  const json = await res.json();
  return { res, json };
}

export type DojahCall =
  | { kind: "ok"; json: unknown }
  | { kind: "rejected"; status: number; json: unknown }
  | { kind: "unavailable" };

/** 4xx replies that blame our account or request (keys, balance, size), never the user's input. */
const OUR_FAULT_4XX = new Set([401, 402, 403, 408, 413, 429]);

/**
 * POST JSON to Dojah with a timeout. Only a definite 4xx about the user's input is "rejected".
 * 401/402/403/408/413/429, 5xx, timeouts, network errors and non-JSON bodies are "unavailable"
 * (the caller must not charge an attempt).
 */
export async function dojahPostJson(
  path: string,
  body: unknown,
  headers: Record<string, string>,
  timeoutMs = 20_000,
): Promise<DojahCall> {
  let res: Response;
  try {
    res = await fetch(`${dojahBaseUrl()}${path.startsWith("/") ? path : `/${path}`}`, {
      method: "POST",
      headers: { ...headers, "Content-Type": "application/json" },
      body: JSON.stringify(body),
      signal: AbortSignal.timeout(timeoutMs),
    });
  } catch {
    return { kind: "unavailable" };
  }
  let json: unknown;
  try {
    json = await res.json();
  } catch {
    return { kind: "unavailable" };
  }
  if (res.ok) return { kind: "ok", json };
  if (res.status >= 400 && res.status < 500 && !OUR_FAULT_4XX.has(res.status)) {
    return { kind: "rejected", status: res.status, json };
  }
  console.error("Dojah unavailable", { path, status: res.status });
  return { kind: "unavailable" };
}
