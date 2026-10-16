// Admin role matrix. The server is the authority; the admin app mirrors this list.
export type AdminRole = "super_admin" | "finance" | "support" | "compliance" | "moderation";

export const ROLE_PERMISSIONS: Record<AdminRole, readonly string[]> = {
  super_admin: ["*"],
  finance: [
    "dashboard", "transactions.view", "transactions.write", "payments", "queue",
    "webhooks.view", "webhooks.write", "psp_events", "payment_rails", "dance_floor",
  ],
  support: [
    "dashboard", "users.view", "transactions.view", "payments", "queue",
    "webhooks.view", "psp_events", "floor_avatars", "events.view", "events.end",
  ],
  compliance: ["dashboard", "kyc", "users.view", "users.suspend"],
  moderation: ["dashboard", "events.view", "events.flag", "events.end", "ads", "floor_avatars", "users.view"],
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
      return null;
    case "transactions":
      if (get && !action) return "transactions.view";
      if (post && hasId && ["flag", "unflag", "refund"].includes(action ?? "")) return "transactions.write";
      return null;
    case "kyc":
      return get && !action ? "kyc" : null;
    case "events":
      if (get && !action) return "events.view";
      if (post && hasId && (action === "flag" || action === "unflag")) return "events.flag";
      if (post && hasId && action === "end") return "events.end";
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
