import type { AdminEvent, AdminStats, AdminTransaction, KYCSubmission, PlatformUser } from "@/types/admin";

// Admin API rows → UI shapes. Amounts arrive in kobo (NGN) or micro-units (USDC).

export function mapTransaction(t: Record<string, unknown>): AdminTransaction {
  const currency = ((t.currency as string) ?? "NGN") as "NGN" | "USDC";
  const divisor = currency === "USDC" ? 1_000_000 : 100;
  const rawFee = Number(t.fee ?? 0);
  const rawAmount = Number(t.amount ?? 0);
  const rawNet = Number(t.net_amount ?? 0);
  const metadata = t.metadata as Record<string, unknown> | undefined;
  const feeBreakdown = metadata?.fee_breakdown as { total_fee_kobo?: number } | undefined;
  const inferredFeeKobo = rawFee > 0
    ? rawFee
    : Number(feeBreakdown?.total_fee_kobo ?? 0) > 0
    ? Number(feeBreakdown?.total_fee_kobo)
    : Math.max(Math.abs(rawNet) - Math.abs(rawAmount), 0);

  return {
    id: t.id as string,
    userId: (t.user_id as string) ?? "",
    userName: (t.user_name as string) ?? "",
    type: (t.type as AdminTransaction["type"]) ?? "deposit",
    amount: rawAmount / divisor,
    fee: inferredFeeKobo / divisor,
    netAmount: rawNet / divisor,
    currency,
    status: (t.status as AdminTransaction["status"]) ?? "pending",
    provider: (t.provider as string) ?? undefined,
    providerRef: (t.provider_ref as string) ?? undefined,
    reference: (t.idempotency_key as string) ?? (t.provider_ref as string) ?? (t.id as string),
    description: (t.description as string) ?? "",
    metadata,
    createdAt: new Date((t.created_at as string) ?? Date.now()),
    processedAt: t.completed_at ? new Date(t.completed_at as string) : undefined,
    flagged: (t.flagged as boolean) ?? false,
    flagReason: (t.flag_reason as string) ?? undefined,
  };
}

// Live events map straight through; scheduled and draft events show as "upcoming".
function eventStatus(status: unknown): AdminEvent["status"] {
  if (status === "live") return "live";
  if (status === "scheduled" || status === "draft") return "upcoming";
  return "ended";
}

function kycLabel(level: number): PlatformUser["kycStatus"] {
  if (level >= 2) return "verified";
  if (level === 1) return "email";
  return "none";
}

export function mapUser(u: Record<string, unknown>): PlatformUser {
  return {
    id: u.id as string,
    name: (u.full_name as string) ?? (u.name as string) ?? "",
    phone: (() => {
      const p = u.phone as string | null | undefined;
      return p && String(p).trim() ? String(p) : null;
    })(),
    email: (u.email as string) ?? "",
    walletBalance: (u.wallet_balance as number) ?? 0,
    totalSprayed: (u.total_sprayed as number) ?? 0,
    totalReceived: (u.total_received as number) ?? 0,
    eventsHosted: (u.events_hosted as number) ?? 0,
    eventsJoined: (u.events_joined as number) ?? 0,
    status: (u.status as PlatformUser["status"]) ?? "active",
    // The list returns kyc_level, not a status: level 1 is a verified email, level 2 BVN + selfie.
    kycStatus: (u.kyc_status as PlatformUser["kycStatus"]) ?? kycLabel(Number(u.kyc_level ?? 0)),
    createdAt: new Date((u.created_at as string) ?? Date.now()),
    lastActive: new Date((u.last_active_at as string) ?? (u.last_active as string) ?? Date.now()),
    suspendedReason: (u.suspended_reason as string) ?? undefined,
  };
}

export function mapEvent(e: Record<string, unknown>): AdminEvent {
  return {
    id: e.id as string,
    name: (e.title as string) ?? "",
    hostId: (e.host_id as string) ?? "",
    hostName: (e.host_name as string) ?? "",
    code: (e.event_code as string) ?? "",
    type: (e.type as AdminEvent["type"]) ?? "other",
    status: eventStatus(e.status),
    participantCount: (e.participant_count as number) ?? 0,
    totalSprayed: ((e.total_sprayed as number) ?? 0) / 100,
    giveawayCount: (e.giveaway_count as number) ?? 0,
    createdAt: new Date((e.created_at as string) ?? Date.now()),
    scheduledAt: e.scheduled_at ? new Date(e.scheduled_at as string) : undefined,
    endedAt: e.ended_at ? new Date(e.ended_at as string) : undefined,
    isPrivate: (e.is_private as boolean) ?? false,
    flagged: (e.flagged as boolean) ?? false,
    flagReason: e.flag_reason as string | undefined,
  };
}

export function mapKyc(k: Record<string, unknown>): KYCSubmission {
  return {
    id: k.id as string,
    userId: (k.user_id as string) ?? "",
    userName: (k.user_name as string) ?? "",
    userEmail: (k.user_email as string) ?? "",
    level: Number(k.level ?? 0),
    status: (k.status as KYCSubmission["status"]) ?? "pending",
    provider: (k.provider as string) ?? undefined,
    rejectionReason: (k.rejection_reason as string) ?? undefined,
    submittedAt: new Date((k.submitted_at as string) ?? (k.created_at as string) ?? Date.now()),
    verifiedAt: k.verified_at ? new Date(k.verified_at as string) : undefined,
  };
}

export function mapStats(s: Record<string, number>): AdminStats {
  return {
    totalUsers: s.totalUsers ?? 0,
    activeUsers: s.activeUsers ?? 0,
    suspendedUsers: s.suspendedUsers ?? 0,
    totalTransactions: s.totalTransactions ?? 0,
    totalVolume: (s.totalVolume ?? 0) / 100,
    todayVolume: (s.todayVolume ?? 0) / 100,
    totalFeeRevenue: (s.totalFeeRevenue ?? 0) / 100,
    todayFeeRevenue: (s.todayFeeRevenue ?? 0) / 100,
    activeEvents: s.activeEvents ?? 0,
    totalEvents: s.totalEvents ?? 0,
    flaggedTransactions: s.flaggedTransactions ?? 0,
    stuckWithdrawals: s.stuckWithdrawals ?? 0,
  };
}
