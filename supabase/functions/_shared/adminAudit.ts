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
