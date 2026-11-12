import { getServiceClient } from "./db.ts";


const inMemoryStore = new Map<string, { count: number; resetAt: number }>();

export interface RateLimitConfig {
  key: string;
  maxRequests: number;
  windowMs: number;
}

export interface RateLimitResult {
  allowed: boolean;
  remaining: number;
  retryAfterMs?: number;
}

/**
 * Counts in the database (consume_rate_limit, migration 085), so the limit holds across function instances
 * and restarts. If the database call itself fails, this instance's memory is the fallback: a limiter
 * outage must not take the endpoints down with it.
 */
export async function checkRateLimit(config: RateLimitConfig): Promise<RateLimitResult> {
  try {
    const { data, error } = await getServiceClient().rpc("consume_rate_limit", {
      p_key: config.key,
      p_max: config.maxRequests,
      p_window_seconds: Math.max(1, Math.ceil(config.windowMs / 1000)),
    });
    if (!error && typeof data === "boolean") {
      return data ? { allowed: true, remaining: 0 } : { allowed: false, remaining: 0, retryAfterMs: config.windowMs };
    }
  } catch {
    // fall through to memory
  }
  return checkInMemory(config);
}

/**
 * This instance's memory only. For limits keyed on something the caller chooses (the public projector's
 * client address): in the database every made-up key would leave rows behind.
 */
export function checkRateLimitInMemory(config: RateLimitConfig): RateLimitResult {
  return checkInMemory(config);
}

function checkInMemory(config: RateLimitConfig): RateLimitResult {
  const now = Date.now();
  const entry = inMemoryStore.get(config.key);

  if (entry && now < entry.resetAt) {
    if (entry.count >= config.maxRequests) {
      return {
        allowed: false,
        remaining: 0,
        retryAfterMs: entry.resetAt - now,
      };
    }
    entry.count++;
    return { allowed: true, remaining: config.maxRequests - entry.count };
  }

  inMemoryStore.set(config.key, { count: 1, resetAt: now + config.windowMs });

  if (inMemoryStore.size > 10000) {
    for (const [k, v] of inMemoryStore) {
      if (now > v.resetAt) inMemoryStore.delete(k);
    }
  }

  return { allowed: true, remaining: config.maxRequests - 1 };
}

/**
 * Pre-built rate limit configs for common endpoints.
 * Key should include the user ID or IP to scope per-actor.
 */
export const RATE_LIMITS = {
  withdrawal: (userId: string): RateLimitConfig => ({
    key: `wd:${userId}`,
    maxRequests: 5,
    windowMs: 60_000,
  }),

  transfer: (userId: string): RateLimitConfig => ({
    key: `xfer:${userId}`,
    maxRequests: 10,
    windowMs: 60_000,
  }),

  kycAttempt: (userId: string): RateLimitConfig => ({
    key: `kyc:${userId}`,
    maxRequests: 3,
    windowMs: 60 * 60_000,
  }),

  spray: (userId: string): RateLimitConfig => ({
    key: `spray:${userId}`,
    maxRequests: 30,
    windowMs: 60_000,
  }),

  giveawayRedeem: (userId: string): RateLimitConfig => ({
    key: `ga-redeem:${userId}`,
    maxRequests: 10,
    windowMs: 60_000,
  }),

  apiGeneral: (ip: string): RateLimitConfig => ({
    key: `api:${ip}`,
    maxRequests: 100,
    windowMs: 60_000,
  }),

  /** Looking a giveaway up by code: a guess at a 6-character code, so it is counted. */
  giveawayLookup: (userId: string): RateLimitConfig => ({
    key: `ga-lookup:${userId}`,
    maxRequests: 20,
    windowMs: 60_000,
  }),

  /** Name enquiry is a paid provider call and maps account numbers to names. */
  bankVerify: (userId: string): RateLimitConfig => ({
    key: `bank-verify:${userId}`,
    maxRequests: 10,
    windowMs: 60_000,
  }),

  bankList: (userId: string): RateLimitConfig => ({
    key: `bank-list:${userId}`,
    maxRequests: 20,
    windowMs: 60_000,
  }),

  /** Username lookup for Send: enough to type a name, not enough to scrape. */
  userLookup: (userId: string): RateLimitConfig => ({
    key: `user-lookup:${userId}`,
    maxRequests: 30,
    windowMs: 60_000,
  }),

  /** Anonymous public projector: per IP + event. */
  publicProjector: (scope: string): RateLimitConfig => ({
    key: `pub-proj:${scope}`,
    maxRequests: 60,
    windowMs: 60_000,
  }),
};
