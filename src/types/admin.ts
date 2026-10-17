// Admin System Types

export type AdminRole = "super_admin" | "finance" | "support" | "compliance" | "moderation";

export interface AdminUser {
  id: string;
  name: string;
  email: string;
  role: AdminRole;
  avatar?: string;
  createdAt: Date;
  lastLogin?: Date;
}

export interface PlatformUser {
  id: string;
  name: string;
  phone: string | null;
  email?: string;
  avatar?: string;
  walletBalance: number;
  totalSprayed: number;
  totalReceived: number;
  eventsHosted: number;
  eventsJoined: number;
  status: "active" | "suspended" | "banned";
  kycStatus: "none" | "email" | "pending" | "verified" | "rejected";
  createdAt: Date;
  lastActive: Date;
  suspendedReason?: string;
}

export interface AdminTransaction {
  id: string;
  userId: string;
  userName: string;
  type: "deposit" | "withdrawal" | "spray" | "giveaway" | "refund";
  amount: number;
  currency: "NGN" | "USDC";
  status: "pending" | "processing" | "completed" | "failed" | "refunded";
  provider?: string;
  providerRef?: string;
  method?: string;
  reference: string;
  description: string;
  createdAt: Date;
  processedAt?: Date;
  flagged?: boolean;
  flagReason?: string;
  fee?: number;
  netAmount?: number;
  metadata?: Record<string, unknown>;
}

export interface AdminLedgerEntry {
  id: string;
  entryType: "debit" | "credit";
  amount: number;
  balanceBefore: number;
  balanceAfter: number;
  createdAt: Date;
}

export interface PspEventRecord {
  id: string;
  transactionId?: string;
  providerId: string;
  direction: "inbound" | "outbound";
  eventType: string;
  status?: string;
  providerStatus?: string;
  reference?: string;
  providerRef?: string;
  requestSummary?: Record<string, unknown>;
  responseSummary?: Record<string, unknown>;
  errorMessage?: string;
  createdAt: Date;
}

export interface WebhookLogSummary {
  id: string;
  provider: string;
  eventType?: string;
  processed: boolean;
  processingError?: string;
  signatureValid?: boolean;
  idempotencyKey?: string;
  createdAt: Date;
  processedAt?: Date;
}

export interface WebhookLogDetail extends WebhookLogSummary {
  payload: Record<string, unknown>;
  headers?: Record<string, unknown>;
  signature?: string;
}

export interface AdminTransactionDetail {
  transaction: AdminTransaction & {
    userPhone?: string;
    userEmail?: string;
  };
  ledgerEntries: AdminLedgerEntry[];
  pspEvents: PspEventRecord[];
  relatedWebhooks: WebhookLogSummary[];
}

export interface PaymentsOverview {
  today: {
    deposits: { count: number; volumeKobo: number };
    withdrawals: { count: number; volumeKobo: number };
  };
  queues: {
    pendingWithdrawals: number;
    processingWithdrawals: number;
    failed24h: number;
    unprocessedWebhooks: number;
  };
  platform: PlatformPaymentSettings;
  byProvider: { provider: string; deposits: number; withdrawals: number; failed: number }[];
  recentFailures: {
    id: string;
    type: string;
    amount: number;
    currency: string;
    provider?: string;
    reference: string;
    userName: string;
    createdAt: Date;
  }[];
  providerHealth: {
    providerId: string;
    ok: boolean;
    message: string;
    checkedAt: Date;
  }[];
}

export interface ReviewQueueItem {
  id: string;
  type?: string;
  amount?: number;
  currency?: string;
  provider?: string;
  status?: string;
  reference?: string;
  userName?: string;
  flagReason?: string;
  eventType?: string;
  processingError?: string;
  idempotencyKey?: string;
  createdAt: Date;
}

export interface ReviewQueue {
  stuckWithdrawals: ReviewQueueItem[];
  unprocessedWebhooks: ReviewQueueItem[];
  flaggedTransactions: ReviewQueueItem[];
}

export interface KYCSubmission {
  id: string;
  userId: string;
  userName: string;
  userEmail: string;
  level: number;
  status: "pending" | "verified" | "rejected" | "expired";
  provider?: string;
  rejectionReason?: string;
  submittedAt: Date;
  verifiedAt?: Date;
}

export interface AdminEvent {
  id: string;
  name: string;
  hostId: string;
  hostName: string;
  code: string;
  type: "wedding" | "birthday" | "party" | "corporate" | "other";
  status: "upcoming" | "live" | "ended";
  participantCount: number;
  totalSprayed: number;
  giveawayCount: number;
  createdAt: Date;
  scheduledAt?: Date;
  endedAt?: Date;
  flagged?: boolean;
  flagReason?: string;
  isPrivate?: boolean;
}

export type PspCapability = "wallet_funding" | "disbursement" | "bank_verify";
export type PspProviderStatus = "active" | "disabled" | "sandbox_only";
export type PspEnv = "sandbox" | "production";

export interface PspProvider {
  id: string;
  displayName: string;
  capabilities: PspCapability[];
  status: PspProviderStatus;
  configSchema: Record<string, unknown>;
  updatedAt?: Date;
}

export interface PlatformPaymentSettings {
  walletFundingProviderId: string;
  disbursementProviderId: string;
  pspEnv: PspEnv;
  updatedAt?: Date;
}

export interface AdminStats {
  totalUsers: number;
  activeUsers: number;
  suspendedUsers: number;
  totalTransactions: number;
  totalVolume: number;
  todayVolume: number;
  totalFeeRevenue: number;
  todayFeeRevenue: number;
  activeEvents: number;
  totalEvents: number;
  flaggedTransactions: number;
  stuckWithdrawals: number;
}

// Role permissions: mirrors supabase/functions/_shared/adminAccess.ts (the server is the authority;
// adminAccess.parity.test.ts keeps the two equal).
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

export const can = (role: string | null | undefined, permission: string): boolean => {
  if (!role || !Object.prototype.hasOwnProperty.call(ROLE_PERMISSIONS, role)) return false;
  const perms = ROLE_PERMISSIONS[role as AdminRole];
  return perms.includes("*") || perms.includes(permission);
};

export const ROLE_LABELS: Record<AdminRole, string> = {
  super_admin: "Super Admin",
  finance: "Finance",
  support: "Support",
  compliance: "Compliance",
  moderation: "Moderation",
};

export const ROLE_COLORS: Record<AdminRole, string> = {
  super_admin: "bg-primary text-primary-foreground",
  finance: "bg-secondary text-secondary-foreground",
  support: "bg-accent text-accent-foreground",
  compliance: "bg-success text-success-foreground",
  moderation: "bg-destructive text-destructive-foreground",
};
