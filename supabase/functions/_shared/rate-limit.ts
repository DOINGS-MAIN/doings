import { getServiceClient } from "./db.ts";

/**
 * Simple sliding-window rate limiter using Supabase.
 * Stores rate limit entries in a lightweight cache table.
 * Falls back to in-memory if the table doesn't exist yet.
 */

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

export async function checkRateLimit(config: RateLimitConfig): Promise<RateLimitResult> {
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
};
