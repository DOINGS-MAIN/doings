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
  phone: string;
  email?: string;
  avatar?: string;
  walletBalance: number;
  totalSprayed: number;
  totalReceived: number;
  eventsHosted: number;
  eventsJoined: number;
  status: "active" | "suspended" | "banned";
  kycStatus: "none" | "pending" | "verified" | "rejected";
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
  status: "pending" | "completed" | "failed" | "refunded";
  method?: string;
  reference: string;
  description: string;
  createdAt: Date;
  processedAt?: Date;
  flagged?: boolean;
  flagReason?: string;
}

export interface KYCSubmission {
  id: string;
  userId: string;
  userName: string;
  userPhone: string;
  bvn: string;
  nin?: string;
  idType: "national_id" | "drivers_license" | "passport" | "voters_card";
  idNumber: string;
  idImageUrl: string;
  selfieUrl: string;
  status: "pending" | "approved" | "rejected";
  submittedAt: Date;
  reviewedAt?: Date;
  reviewedBy?: string;
  rejectionReason?: string;
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
}

export interface AdminStats {
  totalUsers: number;
  activeUsers: number;
  suspendedUsers: number;
  pendingKYC: number;
  totalTransactions: number;
  totalVolume: number;
  todayVolume: number;
  activeEvents: number;
  totalEvents: number;
  flaggedTransactions: number;
}

// Role permissions
export const ROLE_PERMISSIONS: Record<AdminRole, string[]> = {
  super_admin: ["*"],
  finance: ["dashboard", "transactions", "reports"],
  support: ["dashboard", "users", "transactions.view"],
  compliance: ["dashboard", "kyc", "users.view"],
  moderation: ["dashboard", "events", "users.view"],
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
