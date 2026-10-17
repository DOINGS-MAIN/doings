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

export interface AdminPayout {
  id: string;
  userId: string;
  userName: string;
  currency: "NGN" | "USDC";
  /** Display units (naira or USDC), always positive. */
  amount: number;
  fee: number;
  status: string;
  provider?: string;
  reference: string;
  providerRef?: string;
  kind: "sale" | "withdrawal";
  bundles?: number;
  needsReview: boolean;
  lastCheck?: { status: string; providerStatus?: string; at: Date };
  manualResolution?: { outcome: "paid" | "failed"; reason: string; at: Date };
  failureReason?: string;
  createdAt: Date;
  updatedAt?: Date;
  /** USDC sales: the NGN taken from the person's Bag (amount above is the USDC paid out). */
  ngnAmount?: number;
  address?: string;
  txHash?: string;
  /** Set when the provider reported this payout as paid after it was marked failed. */
  paidAfterFailed?: Date;
}

export interface AdminBundleOrder {
  id: string;
  userId: string;
  userName: string;
  currency: "NGN" | "USDC";
  bundles: number;
  /** Display units: naira for NGN orders, USDC for USDC orders. */
  amount: number;
  status: string;
  txRef: string;
  providerRef?: string;
  failureReason?: string;
  refund?: { reference: string; amount: number; note?: string; at: Date };
  /** Paid (provider ref recorded) but failed, with no outside refund recorded yet. */
  paidButFailed: boolean;
  createdAt: Date;
}

export interface MoneyOverview {
  byType: { type: string; currency: "NGN" | "USDC"; countToday: number; amountToday: number; count7d: number; amount7d: number }[];
  queue: { payoutsNeedingReview: number; ordersPaidFailed: number; ordersPendingFloat: number };
  /** Treasury wallets, in display units (empty when the role can't see treasury data). */
  treasury: { currency: string; balance: number; locked: number }[];
  /** Finance and super admins only; the server leaves treasury data out for other roles. */
  treasuryVisible: boolean;
  recentTopups: { id: string; currency: string; amount: number; reference?: string; note?: string; createdAt: Date }[];
}

export interface AdminUser360 {
  user: {
    id: string; name: string; username?: string; email?: string; phone?: string; avatarUrl?: string;
    status: "active" | "suspended" | "banned"; suspendedReason?: string; suspendedAt?: Date; kycLevel: number; createdAt: Date; lastActive?: Date;
  };
  /** Which sections this admin's role may see (the server leaves the others out). */
  can: { profile: boolean; actions: boolean; kyc: boolean; money: boolean; security: boolean; activity: boolean };
  security?: { pinSet: boolean; pinFailedAttempts: number; pinLockedUntil?: Date };
  kyc?: {
    records: {
      id: string; level: number; status: string; method?: string; bvnLastFour?: string; ninLastFour?: string;
      matchScore?: number; livenessScore?: number; rejectionReason?: string; submittedAt: Date; verifiedAt?: Date; reviewedAt?: Date; superseded: boolean;
    }[];
    attempts24h: number;
    attemptsMax: number;
  };
  money?: {
    wallets: { currency: string; balance: number; held: number }[];
    transactions: { id: string; type: string; currency: string; amount: number; status: string; reference: string; createdAt: Date }[];
    openPayouts: { id: string; currency: string; amount: number; status: string; reference: string; needsReview: boolean; createdAt: Date }[];
    bundleOrders: { id: string; currency: string; bundles: number; amount: number; status: string; refunded: boolean; createdAt: Date }[];
    bankAccounts: { id: string; bankName: string; accountName: string; accountNumber: string; isDefault: boolean }[];
  };
  activity?: { eventsHosted: { id: string; title: string; status: string; code: string; createdAt: Date }[]; giveawaysCreated: number };
}

export interface AdminGiveaway {
  id: string;
  creatorId: string;
  creatorName: string;
  title: string;
  /** Masked (••••XX) while active: the server never sends a claimable code to the list or detail. */
  code: string;
  codeMasked: boolean;
  status: "active" | "stopped" | "exhausted";
  type: "live" | "scheduled";
  /** Naira. */
  total: number;
  perPerson: number;
  remaining: number;
  maxRecipients: number;
  /** Recipients so far: the maximum less what the remainder can still pay. */
  redeemedCount: number;
  eventId?: string;
  eventTitle?: string;
  eventCode?: string;
  isPrivate: boolean;
  stoppedAt?: Date;
  stopReason?: string;
  createdAt: Date;
}

export interface AdminGiveawayDetail {
  giveaway: AdminGiveaway;
  creator: { id: string; name: string; email?: string } | null;
  event: { id: string; title: string; code: string; status: string } | null;
  redemptions: { id: string; userId: string; userName: string; amount: number; redeemedAt: Date }[];
  fundingTransactionId?: string;
  refundTransactionId?: string;
  stoppedByEmail?: string;
}

export interface AdminLiveEvent {
  event: {
    id: string; title: string; code: string; status: string; type: string; isPrivate: boolean; participants: number;
    /** Naira. */
    totalSprayed: number; flagged: boolean; flagReason?: string; startedAt?: Date; endedAt?: Date;
  };
  host: { id: string; name: string; email?: string } | null;
  /** Naira. */
  totals: { holdsActive: number; held: number; sprayed: number };
  floor: {
    id: string; sprayerId: string; name: string; held: number; slot: number; seconds: number;
    startedAt?: Date; endsAt?: Date; chargedSoFar: number;
  }[];
  queue: { id: string; sprayerId: string; name: string; held: number; queuedAt?: Date; position: number }[];
  holds: { id: string; sprayerId: string; name: string; held: number; createdAt: Date; expiresAt?: Date }[];
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
  usdcVolume: number;
  usdcTodayVolume: number;
}

// Role permissions: mirrors supabase/functions/_shared/adminAccess.ts (the server is the authority;
// adminAccess.parity.test.ts keeps the two equal).
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
