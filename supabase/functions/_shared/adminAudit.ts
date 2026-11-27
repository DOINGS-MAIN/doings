// The address an admin request came from, for the audit log. Only a well-formed address is returned:
// the value goes into an INET column, and a bad one would fail the log write (and with it the action).
// The edge network's own header comes first: x-forwarded-for is a list the caller can start themselves,
// so it is only the fallback.
const IPV4 = /^(\d{1,3})\.(\d{1,3})\.(\d{1,3})\.(\d{1,3})$/;

function isIpv4(s: string): boolean {
  const m = IPV4.exec(s);
  return !!m && m.slice(1).every((part) => Number(part) <= 255);
}

function isIpv6(s: string): boolean {
  if (!/^[0-9a-fA-F:]+$/.test(s) || !s.includes(":")) return false;
  const halves = s.split("::");
  if (halves.length > 2) return false;
  const groups = halves.flatMap((half) => (half === "" ? [] : half.split(":")));
  if (!groups.every((g) => /^[0-9a-fA-F]{1,4}$/.test(g))) return false;
  return halves.length === 2 ? groups.length <= 7 : groups.length === 8;
}

export function clientIp(headers: Headers): string | null {
  const candidates = [
    headers.get("cf-connecting-ip"),
    headers.get("x-real-ip"),
    headers.get("x-forwarded-for")?.split(",")[0],
  ];
  for (const raw of candidates) {
    const ip = raw?.trim();
    if (ip && (isIpv4(ip) || isIpv6(ip))) return ip;
  }
  return null;
}

export type AuditEntry = { action: string; targetType: string; targetId?: string | null; details?: unknown };
export type Audit = (entry: AuditEntry) => Promise<void>;
type Rpc = (fn: string, args: Record<string, unknown>) => PromiseLike<{ error: unknown }>;

// Writes one audit record for this admin and request. A failed write throws, so the request fails
// loudly instead of an action going unrecorded.
export function makeAudit(rpc: Rpc, adminId: string, ip: string | null): Audit {
  return async ({ action, targetType, targetId, details }) => {
    const { error } = await rpc("log_admin_action", {
      p_admin_id: adminId,
      p_action: action,
      p_target_type: targetType,
      p_target_id: targetId ?? null,
      p_details: details ?? null,
      p_ip_address: ip,
    });
    if (error) throw error;
  };
}

// The optional reason an admin typed for an action (lifting a ban, removing a flag), as audit details.
// Nothing is recorded when none was given; a long one is cut to 500 characters.
export function reasonDetails(body: unknown): { reason: string } | undefined {
  const raw = (body as { reason?: unknown } | null)?.reason;
  const reason = typeof raw === "string" ? raw.trim().slice(0, 500) : "";
  return reason ? { reason } : undefined;
}

export type AuditedOptions<T> = {
  // Why the action did nothing, or null when it went through. Default: an error response (status 400+).
  notDone?: (value: T) => string | null;
  // What the action found, recorded afterwards as "<action>_result".
  result?: (value: T) => unknown;
};

function refusedResponse(value: unknown): string | null {
  return value instanceof Response && value.status >= 400 ? `refused with status ${value.status}` : null;
}

// Runs an admin action with its audit record written FIRST. If the record cannot be written the
// action never runs, so nothing an admin does can go unrecorded. The record is written before the
// outcome is known, so an action that then throws or is refused gets a second record,
// "<action>_failed", with the reason. That second record (and "<action>_result") is best effort:
// losing it over-reports an action, which is the safe direction for an audit trail.
export async function audited<T>(
  audit: Audit,
  entry: AuditEntry,
  act: () => Promise<T>,
  options: AuditedOptions<T> = {},
): Promise<T> {
  await audit(entry);
  const followUp = async (suffix: string, details: unknown) => {
    try {
      await audit({ action: `${entry.action}_${suffix}`, targetType: entry.targetType, targetId: entry.targetId, details });
    } catch (err) {
      console.error(`audit follow-up ${entry.action}_${suffix} was not written`, err);
    }
  };
  let value: T;
  try {
    value = await act();
  } catch (err) {
    await followUp("failed", { reason: err instanceof Error ? err.message : String((err as { message?: unknown })?.message ?? err) });
    throw err;
  }
  const reason = (options.notDone ?? refusedResponse)(value);
  if (reason) await followUp("failed", { reason });
  else if (options.result) await followUp("result", options.result(value));
  return value;
}
