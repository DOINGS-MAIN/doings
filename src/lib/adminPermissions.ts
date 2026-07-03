import { AdminRole, ROLE_PERMISSIONS } from "@/types/admin";

function hasPermission(role: AdminRole, permission: string): boolean {
  const permissions = ROLE_PERMISSIONS[role] ?? [];
  return (
    permissions.includes("*") ||
    permissions.includes(permission) ||
    permissions.some((p) => permission.startsWith(p.replace(".view", "")))
  );
}

export function canViewPayments(role: AdminRole): boolean {
  return hasPermission(role, "payments") || hasPermission(role, "transactions");
}

export function canWritePayments(role: AdminRole): boolean {
  return role === "super_admin" || role === "finance";
}

export function canViewWebhooks(role: AdminRole): boolean {
  return hasPermission(role, "webhooks");
}

export function canWriteWebhooks(role: AdminRole): boolean {
  return canWritePayments(role);
}

export function canManagePaymentRails(role: AdminRole): boolean {
  return canWritePayments(role);
}
