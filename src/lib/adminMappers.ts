import type {
  AdminBundleOrder, AdminEvent, AdminGiveaway, AdminGiveawayDetail, AdminPayout, AdminUser360, AdminStats, AdminTransaction, KYCSubmission, MoneyOverview, PaymentsOverview,
  PlatformUser, ReviewQueue, ReviewQueueItem,
} from "@/types/admin";

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
    usdcVolume: (s.usdcVolume ?? 0) / 1_000_000,
    usdcTodayVolume: (s.usdcTodayVolume ?? 0) / 1_000_000,
  };
}

const toDisplay = (amount: number, currency: string) =>
  currency === "USDC" ? amount / 1_000_000 : amount / 100;

const dateOr = (v: unknown): Date | undefined => (v ? new Date(v as string) : undefined);

export function mapPayout(t: Record<string, unknown>): AdminPayout {
  const m = (t.metadata ?? {}) as Record<string, unknown>;
  // A USDC bundle sale is an NGN row (the Bag is debited in NGN) that pays out USDC.
  const usdcSale = m.kind === "bundle_sale_usdc";
  const rowCurrency = ((t.currency as string) ?? "NGN") as AdminPayout["currency"];
  const currency: AdminPayout["currency"] = usdcSale ? "USDC" : rowCurrency;
  const paidAfter = m.provider_paid_after_failed as Record<string, unknown> | undefined;
  const check = m.last_provider_check as Record<string, unknown> | undefined;
  const manual = m.manual_resolution as Record<string, unknown> | undefined;
  return {
    id: t.id as string,
    userId: (t.user_id as string) ?? "",
    userName: (t.user_name as string) ?? "",
    currency,
    amount: usdcSale ? Number(m.usdc_micro ?? 0) / 1_000_000 : Math.abs(toDisplay(Number(t.amount ?? 0), rowCurrency)),
    fee: toDisplay(Number(t.fee ?? 0), rowCurrency),
    ngnAmount: usdcSale ? Math.abs(toDisplay(Number(t.amount ?? 0), "NGN")) : undefined,
    address: (m.address as string) ?? undefined,
    txHash: (m.tx_hash as string) ?? (m.blockradar_tx_hash as string) ?? undefined,
    paidAfterFailed: paidAfter ? new Date((paidAfter.at as string) ?? Date.now()) : undefined,
    status: (t.status as string) ?? "pending",
    provider: (t.provider as string) ?? undefined,
    reference: (t.idempotency_key as string) ?? (t.id as string),
    providerRef: (t.provider_ref as string) ?? undefined,
    kind: String(m.kind ?? "").startsWith("bundle_sale") ? "sale" : "withdrawal",
    bundles: m.bundles != null ? Number(m.bundles) : undefined,
    needsReview: m.needs_review === true || m.needs_review === "true",
    lastCheck: check
      ? { status: String(check.status ?? ""), providerStatus: (check.provider_status as string) ?? undefined, at: new Date((check.at as string) ?? Date.now()) }
      : undefined,
    manualResolution: manual
      ? { outcome: manual.outcome as "paid" | "failed", reason: String(manual.reason ?? ""), at: new Date((manual.at as string) ?? Date.now()) }
      : undefined,
    failureReason: (m.failure_reason as string) ?? undefined,
    createdAt: new Date((t.created_at as string) ?? Date.now()),
    updatedAt: dateOr(t.updated_at),
  };
}

export function mapBundleOrder(o: Record<string, unknown>): AdminBundleOrder {
  const currency = ((o.currency as string) ?? "NGN") as AdminBundleOrder["currency"];
  const refundedAt = o.refunded_at as string | null | undefined;
  return {
    id: o.id as string,
    userId: (o.user_id as string) ?? "",
    userName: (o.user_name as string) ?? "",
    currency,
    bundles: Number(o.bundles ?? 0),
    amount: toDisplay(Number(o.amount ?? 0), currency),
    status: (o.status as string) ?? "",
    txRef: (o.tx_ref as string) ?? "",
    providerRef: (o.provider_ref as string) ?? undefined,
    failureReason: (o.failure_reason as string) ?? undefined,
    refund: refundedAt
      ? {
        reference: (o.refund_reference as string) ?? "",
        amount: Number(o.refund_amount_kobo ?? 0) / 100,
        note: (o.refund_note as string) ?? undefined,
        at: new Date(refundedAt),
      }
      : undefined,
    paidButFailed: currency === "NGN" && o.status === "failed" && String(o.provider_ref ?? "").trim() !== "" && !refundedAt,
    createdAt: new Date((o.created_at as string) ?? Date.now()),
  };
}

function mapMoney(res: Record<string, unknown>): MoneyOverview {
  const money = (res.money ?? {}) as Record<string, unknown>;
  const queue = (money.queue ?? {}) as Record<string, number>;
  return {
    byType: ((money.by_type as Record<string, unknown>[]) ?? []).map((r) => {
      const cur = ((r.currency as string) ?? "NGN") as "NGN" | "USDC";
      return {
        type: r.type as string,
        currency: cur,
        countToday: Number(r.count_today ?? 0),
        amountToday: toDisplay(Number(r.amount_today ?? 0), cur),
        count7d: Number(r.count_7d ?? 0),
        amount7d: toDisplay(Number(r.amount_7d ?? 0), cur),
      };
    }),
    queue: {
      payoutsNeedingReview: Number(queue.payouts_needing_review ?? 0),
      ordersPaidFailed: Number(queue.orders_paid_failed ?? 0),
      ordersPendingFloat: Number(queue.orders_pending_float ?? 0),
    },
    treasuryVisible: Array.isArray(res.treasury),
    treasury: ((res.treasury as Record<string, unknown>[]) ?? []).map((w) => ({
      currency: (w.currency as string) ?? "",
      balance: toDisplay(Number(w.balance ?? 0), (w.currency as string) ?? "NGN"),
      locked: toDisplay(Number(w.locked_balance ?? 0), (w.currency as string) ?? "NGN"),
    })),
    recentTopups: ((res.recent_topups as Record<string, unknown>[]) ?? []).map((r) => ({
      id: r.id as string,
      currency: (r.currency as string) ?? "",
      amount: toDisplay(Number(r.amount ?? 0), (r.currency as string) ?? "NGN"),
      reference: (r.reference as string) ?? undefined,
      note: (r.note as string) ?? undefined,
      createdAt: new Date((r.created_at as string) ?? Date.now()),
    })),
  };
}

// Moved from useAdminMonitoring.fetchOverview, plus the money overview, treasury and top-ups.
export function mapPaymentsOverview(res: Record<string, unknown>): PaymentsOverview & { money: MoneyOverview } {
  return {
    today: {
      deposits: {
        count: ((res.today as Record<string, unknown>)?.deposits as Record<string, number>)?.count ?? 0,
        volumeKobo: ((res.today as Record<string, unknown>)?.deposits as Record<string, number>)?.volume_kobo ?? 0,
      },
      withdrawals: {
        count: ((res.today as Record<string, unknown>)?.withdrawals as Record<string, number>)?.count ?? 0,
        volumeKobo: ((res.today as Record<string, unknown>)?.withdrawals as Record<string, number>)?.volume_kobo ?? 0,
      },
    },
    queues: {
      pendingWithdrawals: (res.queues as Record<string, number>)?.pending_withdrawals ?? 0,
      processingWithdrawals: (res.queues as Record<string, number>)?.processing_withdrawals ?? 0,
      failed24h: (res.queues as Record<string, number>)?.failed_24h ?? 0,
      unprocessedWebhooks: (res.queues as Record<string, number>)?.unprocessed_webhooks ?? 0,
    },
    platform: {
      walletFundingProviderId: (res.platform as Record<string, string>)?.wallet_funding_provider_id ?? "monnify",
      disbursementProviderId: (res.platform as Record<string, string>)?.disbursement_provider_id ?? "monnify",
      pspEnv: ((res.platform as Record<string, string>)?.psp_env ?? "sandbox") as PaymentsOverview["platform"]["pspEnv"],
    },
    byProvider: ((res.by_provider as Record<string, unknown>[]) ?? []).map((row) => ({
      provider: row.provider as string,
      deposits: row.deposits as number,
      withdrawals: row.withdrawals as number,
      failed: row.failed as number,
    })),
    recentFailures: ((res.recent_failures as Record<string, unknown>[]) ?? []).map((row) => ({
      id: row.id as string,
      type: row.type as string,
      amount: toDisplay((row.amount as number) ?? 0, (row.currency as string) ?? "NGN"),
      currency: row.currency as string,
      provider: row.provider as string | undefined,
      reference: row.reference as string,
      userName: row.user_name as string,
      createdAt: new Date((row.created_at as string) ?? Date.now()),
    })),
    providerHealth: ((res.provider_health as Record<string, unknown>[]) ?? []).map((row) => ({
      providerId: (row.provider_id as string) ?? "",
      ok: Boolean(row.ok),
      message: (row.message as string) ?? "",
      checkedAt: new Date((row.checked_at as string) ?? Date.now()),
    })),
    money: mapMoney(res),
  };
}

function mapQueueItem(row: Record<string, unknown>): ReviewQueueItem {
  return {
    id: row.id as string,
    type: row.type as string | undefined,
    amount: row.amount != null ? toDisplay(row.amount as number, (row.currency as string) ?? "NGN") : undefined,
    currency: row.currency as string | undefined,
    provider: row.provider as string | undefined,
    status: row.status as string | undefined,
    reference: (row.idempotency_key as string) ?? (row.tx_ref as string) ?? undefined,
    userName: row.user_name as string | undefined,
    flagReason: (row.flag_reason as string) ?? (row.failure_reason as string) ?? undefined,
    eventType: row.event_type as string | undefined,
    processingError: row.processing_error as string | undefined,
    idempotencyKey: row.idempotency_key as string | undefined,
    createdAt: new Date((row.created_at as string) ?? Date.now()),
  };
}

// Moved from useAdminMonitoring.fetchQueue, plus the money queues.
export function mapQueue(res: Record<string, unknown>): ReviewQueue & {
  payoutsNeedingReview: ReviewQueueItem[];
  ordersPaidFailed: ReviewQueueItem[];
  ordersPendingFloat: ReviewQueueItem[];
} {
  const list = (k: string) => ((res[k] as Record<string, unknown>[]) ?? []).map(mapQueueItem);
  return {
    stuckWithdrawals: list("stuck_withdrawals"),
    unprocessedWebhooks: list("unprocessed_webhooks"),
    flaggedTransactions: list("flagged_transactions"),
    payoutsNeedingReview: list("payouts_needing_review"),
    ordersPaidFailed: list("orders_paid_failed"),
    ordersPendingFloat: list("orders_pending_float"),
  };
}

const num = (v: unknown): number | undefined => (v == null || v === "" ? undefined : Number(v));
const str = (v: unknown): string | undefined => (v == null || v === "" ? undefined : String(v));

// User 360: a section is present exactly when the server sent it (the role may see it).
export function mapUser360(res: Record<string, unknown>): AdminUser360 {
  const u = (res.user ?? {}) as Record<string, unknown>;
  const sections = (res.sections ?? {}) as Record<string, Record<string, unknown> | undefined>;
  const can = (res.can ?? {}) as AdminUser360["can"];
  const out: AdminUser360 = {
    user: {
      id: u.id as string,
      name: (u.full_name as string) ?? "",
      username: str(u.username),
      email: str(u.email),
      phone: str(u.phone),
      avatarUrl: str(u.avatar_url),
      status: ((u.status as string) ?? "active") as AdminUser360["user"]["status"],
      suspendedReason: str(u.suspended_reason),
      suspendedAt: dateOr(u.suspended_at),
      kycLevel: Number(u.kyc_level ?? 0),
      createdAt: new Date((u.created_at as string) ?? Date.now()),
      lastActive: dateOr(u.last_active_at),
    },
    can: {
      profile: !!can.profile, actions: !!can.actions, kyc: !!can.kyc, money: !!can.money, security: !!can.security, activity: !!can.activity,
    },
  };
  const sec = sections.security;
  if (sec) {
    out.security = { pinSet: !!sec.pin_set, pinFailedAttempts: Number(sec.pin_failed_attempts ?? 0), pinLockedUntil: dateOr(sec.pin_locked_until) };
  }
  const kyc = sections.kyc;
  if (kyc) {
    out.kyc = {
      records: ((kyc.records as Record<string, unknown>[]) ?? []).map((r) => ({
        id: r.id as string,
        level: Number(r.level ?? 0),
        status: (r.status as string) ?? "",
        method: str(r.verification_method),
        bvnLastFour: str(r.bvn_last_four),
        ninLastFour: str(r.nin_last_four),
        matchScore: num(r.selfie_match_confidence),
        livenessScore: num(r.liveness_score),
        rejectionReason: str(r.rejection_reason),
        submittedAt: new Date((r.submitted_at as string) ?? Date.now()),
        verifiedAt: dateOr(r.verified_at),
        reviewedAt: dateOr(r.reviewed_at),
        superseded: !!r.superseded_at,
      })),
      attempts24h: Number(kyc.attempts_24h ?? 0),
      attemptsMax: Number(kyc.attempts_max ?? 5),
    };
  }
  const money = sections.money;
  if (money) {
    const rows = (k: string) => (money[k] as Record<string, unknown>[]) ?? [];
    out.money = {
      wallets: rows("wallets").map((w) => ({
        currency: (w.currency as string) ?? "",
        balance: toDisplay(Number(w.balance ?? 0), (w.currency as string) ?? "NGN"),
        held: toDisplay(Number(w.locked_balance ?? 0), (w.currency as string) ?? "NGN"),
      })),
      transactions: rows("transactions").map((t) => ({
        id: t.id as string,
        type: (t.type as string) ?? "",
        currency: (t.currency as string) ?? "NGN",
        amount: Math.abs(toDisplay(Number(t.amount ?? 0), (t.currency as string) ?? "NGN")),
        status: (t.status as string) ?? "",
        reference: (t.idempotency_key as string) ?? (t.id as string),
        createdAt: new Date((t.created_at as string) ?? Date.now()),
      })),
      openPayouts: rows("open_payouts").map((p) => ({
        id: p.id as string,
        currency: (p.currency as string) ?? "NGN",
        amount: Math.abs(toDisplay(Number(p.amount ?? 0), (p.currency as string) ?? "NGN")),
        status: (p.status as string) ?? "",
        reference: (p.idempotency_key as string) ?? (p.id as string),
        needsReview: !!p.needs_review,
        createdAt: new Date((p.created_at as string) ?? Date.now()),
      })),
      bundleOrders: rows("bundle_orders").map((o) => ({
        id: o.id as string,
        currency: (o.currency as string) ?? "NGN",
        bundles: Number(o.bundles ?? 0),
        amount: toDisplay(Number(o.amount ?? 0), (o.currency as string) ?? "NGN"),
        status: (o.status as string) ?? "",
        refunded: !!o.refunded_at,
        createdAt: new Date((o.created_at as string) ?? Date.now()),
      })),
      bankAccounts: rows("bank_accounts").map((b) => ({
        id: b.id as string,
        bankName: (b.bank_name as string) ?? "",
        accountName: (b.account_name as string) ?? "",
        accountNumber: (b.account_number as string) ?? "",
        isDefault: !!b.is_default,
      })),
    };
  }
  const act = sections.activity;
  if (act) {
    out.activity = {
      eventsHosted: ((act.events_hosted as Record<string, unknown>[]) ?? []).map((e) => ({
        id: e.id as string,
        title: (e.title as string) ?? "",
        status: (e.status as string) ?? "",
        code: (e.event_code as string) ?? "",
        createdAt: new Date((e.created_at as string) ?? Date.now()),
      })),
      giveawaysCreated: Number(act.giveaways_created ?? 0),
    };
  }
  return out;
}

export function mapGiveaway(g: Record<string, unknown>): AdminGiveaway {
  const perKobo = Number(g.per_person_amount ?? 0);
  const remainingKobo = Number(g.remaining_amount ?? 0);
  const max = Number(g.max_recipients ?? 0);
  // The real claim count when the server sent one (a stop zeroes the remainder, so it can't tell);
  // otherwise infer it from what the remainder can still pay.
  const embedded = (g.giveaway_redemptions as { count?: number }[] | undefined)?.[0]?.count;
  const counted = embedded ?? (g.redemption_count as number | undefined);
  const event = g.events as Record<string, unknown> | null | undefined;
  return {
    id: g.id as string,
    creatorId: (g.creator_id as string) ?? "",
    creatorName: (g.user_name as string) ?? "",
    title: (g.title as string) ?? "",
    code: (g.code as string) ?? "",
    codeMasked: g.code_masked === true,
    status: ((g.status as string) ?? "active") as AdminGiveaway["status"],
    type: ((g.type as string) ?? "live") as AdminGiveaway["type"],
    total: Number(g.total_amount ?? 0) / 100,
    perPerson: perKobo / 100,
    remaining: remainingKobo / 100,
    maxRecipients: max,
    redeemedCount: counted != null
      ? Number(counted)
      : Math.max(0, max - (perKobo > 0 ? Math.floor(remainingKobo / perKobo) : 0)),
    eventId: str(g.event_id),
    eventTitle: str(event?.title),
    eventCode: str(event?.event_code),
    isPrivate: !!g.is_private,
    stoppedAt: dateOr(g.stopped_at),
    stopReason: str(g.stop_reason),
    createdAt: new Date((g.created_at as string) ?? Date.now()),
  };
}

export function mapGiveawayDetail(res: Record<string, unknown>): AdminGiveawayDetail {
  const g = (res.giveaway ?? {}) as Record<string, unknown>;
  const c = res.creator as Record<string, unknown> | null;
  const e = res.event as Record<string, unknown> | null;
  const giveaway = mapGiveaway({
    ...g,
    user_name: (c?.full_name as string) ?? g.user_name,
    redemption_count: res.redemption_count ?? g.redemption_count,
    events: e ?? g.events,
  });
  return {
    giveaway,
    creator: c ? { id: c.id as string, name: (c.full_name as string) ?? "", email: str(c.email) } : null,
    event: e ? { id: e.id as string, title: (e.title as string) ?? "", code: (e.event_code as string) ?? "", status: (e.status as string) ?? "" } : null,
    redemptions: ((res.redemptions as Record<string, unknown>[]) ?? []).map((r) => ({
      id: r.id as string,
      userId: (r.user_id as string) ?? "",
      userName: (r.user_name as string) ?? "",
      amount: Number(r.amount ?? 0) / 100,
      redeemedAt: new Date((r.redeemed_at as string) ?? Date.now()),
    })),
    fundingTransactionId: str(g.funding_transaction_id),
    refundTransactionId: str(g.refund_transaction_id),
    stoppedByEmail: str(res.stopped_by_email),
  };
}
