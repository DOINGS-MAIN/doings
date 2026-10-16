import { AdminRole, can } from "@/types/admin";

export function canViewPayments(role: AdminRole): boolean {
  return can(role, "payments") || can(role, "transactions.view");
}

export function canWritePayments(role: AdminRole): boolean {
  return can(role, "transactions.write");
}

export function canViewWebhooks(role: AdminRole): boolean {
  return can(role, "webhooks.view");
}

export function canWriteWebhooks(role: AdminRole): boolean {
  return can(role, "webhooks.write");
}

export function canManagePaymentRails(role: AdminRole): boolean {
  return can(role, "payment_rails");
}
