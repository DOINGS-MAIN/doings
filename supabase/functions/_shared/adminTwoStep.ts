// Two-step sign-in for super admins (migration 111). The admin function verifies the session token
// with the auth server first; these helpers only read what that verified token says.

export type Aal = "aal1" | "aal2";

/** The session's assurance level: "aal2" once an authenticator code was entered, else "aal1". */
export function tokenAal(authHeader: string | null | undefined): Aal {
  const token = (authHeader ?? "").replace(/^Bearer\s+/i, "");
  const payload = token.split(".")[1];
  if (!payload) return "aal1";
  try {
    const b64 = payload.replace(/-/g, "+").replace(/_/g, "/");
    const bytes = Uint8Array.from(atob(b64 + "=".repeat((4 - (b64.length % 4)) % 4)), (c) => c.charCodeAt(0));
    const claims = JSON.parse(new TextDecoder().decode(bytes)) as { aal?: unknown };
    return claims.aal === "aal2" ? "aal2" : "aal1";
  } catch {
    return "aal1";
  }
}

/**
 * Why a request is refused for want of the two-step code, or null. Only super admins are held to it,
 * and only once the rule is switched on. `team/accept` records a sign-in and runs before the code.
 */
export function twoStepRefusal(input: {
  role: string;
  required: boolean;
  aal: Aal;
  resource: string;
  action?: string;
}): string | null {
  if (!input.required || input.role !== "super_admin" || input.aal === "aal2") return null;
  if (input.resource === "team" && input.action === "accept") return null;
  return "Enter your two-step code to continue";
}
