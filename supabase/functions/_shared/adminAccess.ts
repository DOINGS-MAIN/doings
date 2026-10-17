// Admin role matrix. The server is the authority; the admin app mirrors this list.
export type AdminRole = "super_admin" | "finance" | "support" | "compliance" | "moderation";

export const ROLE_PERMISSIONS: Record<AdminRole, readonly string[]> = {
  super_admin: ["*"],
  finance: [
    "dashboard", "transactions.view", "transactions.write", "payments", "queue",
    "webhooks.view", "webhooks.write", "psp_events", "payment_rails", "dance_floor",
    "giveaways.view", "giveaways.stop",
  ],
  support: [
    "dashboard", "users.view", "transactions.view", "payments", "queue",
    "webhooks.view", "psp_events", "floor_avatars", "events.view", "events.end",
    "giveaways.view",
  ],
  compliance: ["dashboard", "kyc", "users.view", "users.suspend"],
  moderation: [
    "dashboard", "events.view", "events.flag", "events.end", "ads", "floor_avatars", "users.view",
    "giveaways.view", "giveaways.stop", "events.floor",
  ],
};

export function isAdminRole(role: string): role is AdminRole {
  return Object.prototype.hasOwnProperty.call(ROLE_PERMISSIONS, role);
}

export function can(role: string, permission: string): boolean {
  if (!isAdminRole(role)) return false;
  const perms = ROLE_PERMISSIONS[role];
  return perms.includes("*") || perms.includes(permission);
}

// The permission an admin route needs; null means the route doesn't exist (404).
export function permissionFor(resource: string, method: string, action?: string, hasId = false): string | null {
  const get = method === "GET";
  const post = method === "POST";
  switch (resource) {
    case "stats":
      return get ? "dashboard" : null;
    case "users":
      if (get && !action) return "users.view";
      if (post && hasId && ["suspend", "unsuspend", "ban", "unban"].includes(action ?? "")) return "users.suspend";
      if (post && hasId && action === "kyc-reset") return "kyc";
      return null;
    case "transactions":
      if (get && !action) return "transactions.view";
      if (post && hasId && ["flag", "unflag", "refund"].includes(action ?? "")) return "transactions.write";
      return null;
    case "kyc":
      if (get && !action) return "kyc";
      if (post && hasId && action === "revoke") return "kyc";
      return null;
    case "events":
      if (get && !action) return "events.view";
      if (post && hasId && (action === "flag" || action === "unflag")) return "events.flag";
      if (post && hasId && action === "end") return "events.end";
      if (post && hasId && action === "advance-floor") return "events.end";
      if (post && hasId && action === "remove-hold") return "events.floor";
      return null;
    case "team":
    case "audit":
      return "*";
    case "payment-rails":
      if (get && (!action || action === "health")) return "payment_rails";
      if (post && action === "probe-all") return "payment_rails";
      return null;
    case "payments":
      return get ? "payments" : null;
    case "webhooks":
      if (get && !action) return "webhooks.view";
      if (post && hasId && action === "reprocess") return "webhooks.write";
      return null;
    case "queue":
      return get ? "queue" : null;
    case "psp-events":
      return get ? "psp_events" : null;
    case "giveaways":
      if (get && !action) return "giveaways.view";
      if (post && hasId && (action === "stop" || action === "reveal-code")) return "giveaways.stop";
      return null;
    case "payouts":
      if (get && !action) return "transactions.view";
      if (post && hasId && (action === "check" || action === "resolve")) return "transactions.write";
      return null;
    case "bundle-orders":
      if (get && !action) return "transactions.view";
      if (post && hasId && (action === "check" || action === "refund")) return "transactions.write";
      return null;
    default:
      return null;
  }
}

// Guards team changes; returns the reason a change is refused, or null when it's allowed.
export function teamChangeAllowed(p: {
  actorAuthId: string;
  targetUserId: string;
  targetRole: string;
  newRole?: string;
  disable?: boolean;
  activeSuperAdmins: number;
}): string | null {
  if (p.newRole !== undefined && !isAdminRole(p.newRole)) return "Unknown role";
  const demoting = p.newRole !== undefined && p.newRole !== "super_admin";
  const removing = p.disable === true || demoting;
  if (!removing) return null;
  if (p.actorAuthId === p.targetUserId) return "You can't disable or demote yourself";
  if (p.targetRole === "super_admin" && p.activeSuperAdmins <= 1) return "You can't remove the last active super admin";
  return null;
}

// Escapes LIKE wildcards so an ilike filter matches the value exactly (case-insensitively).
export function escapeLikePattern(value: string): string {
  return value.replace(/[\\%_]/g, (c) => `\\${c}`);
}

// Marking a payout paid or failed needs its reference typed back, so it can't be done to the wrong row.
export function payoutConfirmMatches(typed: string | null | undefined, reference: string | null | undefined): boolean {
  const ref = (reference ?? "").trim();
  return ref !== "" && (typed ?? "").trim() === ref;
}

// Why "Check with provider" can't run for this row, or null when it can. USDC (Blockradar) payouts
// settle by webhook only, so there's nothing to ask. A failed payout can still be re-checked
// (read-only) to catch a provider that paid after all.
export function payoutCheckRefusal(
  row: { type: string; currency: string; provider: string | null; status: string },
): { status: 400 | 404 | 409; error: string } | null {
  if (row.type !== "withdrawal") return { status: 404, error: "Payout not found" };
  if (row.currency !== "NGN" || row.provider === "blockradar") {
    return { status: 400, error: "USDC payouts settle by webhook — resolve manually" };
  }
  if (row.status !== "pending" && row.status !== "processing" && row.status !== "failed") {
    return { status: 409, error: `Payout is already ${row.status}` };
  }
  return null;
}

// What "Mark failed" does after asking the provider live: refuse when it says paid (the check has
// just completed the payout), report it settled when it says failed, else go ahead manually.
export function failedResolutionGate(
  normalized: string,
): { action: "refuse"; status: 409; error: string } | { action: "settled" } | { action: "proceed" } {
  if (normalized === "terminal_success") {
    return { action: "refuse", status: 409, error: "The provider reports this payout as paid — it has been marked completed" };
  }
  if (normalized === "terminal_failure") return { action: "settled" };
  return { action: "proceed" };
}

export type User360Sections = { profile: boolean; actions: boolean; kyc: boolean; money: boolean; security: boolean; activity: boolean };

// Which parts of a user's 360 page a role may see; the server leaves the rest out of the response.
export function user360Sections(role: string): User360Sections {
  const view = can(role, "users.view");
  return {
    profile: view,
    actions: can(role, "users.suspend"),
    kyc: can(role, "kyc"),
    money: can(role, "transactions.view"),
    security: view,
    activity: view,
  };
}

// Revoking someone's KYC needs their name typed back (email when there's no name on file).
export function nameConfirmMatches(
  typed: string | null | undefined,
  user: { full_name?: string | null; email?: string | null },
): boolean {
  const name = (user.full_name ?? "").trim();
  const target = (name || (user.email ?? "").trim()).toLowerCase();
  return target !== "" && (typed ?? "").trim().toLowerCase() === target;
}

export function maskAccountNumber(n: string | null | undefined): string {
  const s = (n ?? "").trim();
  return s ? `••••${s.slice(-4)}` : "";
}

// Stopping a giveaway needs its code typed back (codes are case-insensitive; spaces are ignored).
export function giveawayCodeMatches(typed: unknown, code: string | null | undefined): boolean {
  const norm = (v: unknown) => (typeof v === "string" ? v.replace(/\s+/g, "").toUpperCase() : "");
  const c = norm(code);
  return c !== "" && norm(typed) === c;
}

// An active giveaway's code is effectively cash (whoever has it can claim), so lists and detail only
// ever show its last two characters; stop roles reveal it through an audited route. Finished
// giveaways can't be claimed any more, so their codes are shown in full.
export function maskGiveawayCode(code: string | null | undefined, status: string): string {
  const c = (code ?? "").trim();
  if (!c) return "";
  return status === "active" ? `••••${c.slice(-2)}` : c;
}

// The one nested admin route: events/:id/holds/:holdId/remove (taking one spray off a live floor).
export function eventHoldRoute(rest: string[]): { id: string; holdId: string } | null {
  if (rest.length !== 5 || rest[0] !== "events" || rest[2] !== "holds" || rest[4] !== "remove") return null;
  if (!rest[1] || !rest[3]) return null;
  return { id: rest[1], holdId: rest[3] };
}
