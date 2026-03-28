import { createClient } from "@supabase/supabase-js";

const supabaseUrl = (import.meta.env.VITE_SUPABASE_URL ?? "").trim();
const supabaseAnonKey = (import.meta.env.VITE_SUPABASE_ANON_KEY ?? "").trim();

/** False if VITE_* were empty when `npm run build` ran (Vite inlines at build time — set these on Railway for the build step). */
export const isSupabaseConfigured = Boolean(supabaseUrl && supabaseAnonKey);

export const supabase = createClient(
  isSupabaseConfigured ? supabaseUrl : "https://invalid.invalid",
  isSupabaseConfigured ? supabaseAnonKey : "invalid"
);

async function authHeaders(): Promise<Record<string, string>> {
  let { data: { session } } = await supabase.auth.getSession();
  const nowSec = Math.floor(Date.now() / 1000);
  if (session?.refresh_token) {
    const exp = session.expires_at ?? 0;
    if (exp <= nowSec + 600) {
      const { data, error } = await supabase.auth.refreshSession();
      if (!error && data.session) session = data.session;
    }
  }
  const token = session?.access_token;
  // Gateway requires project anon key on every Functions request; without it you often get "Invalid JWT".
  const headers: Record<string, string> = {
    apikey: supabaseAnonKey,
    "Content-Type": "application/json",
  };
  if (token) headers.Authorization = `Bearer ${token}`;
  return headers;
}

async function invoke<T = unknown>(fnName: string, options?: {
  method?: string;
  body?: unknown;
  params?: Record<string, string>;
  path?: string;
}): Promise<T> {
  const method = options?.method ?? "POST";
  const headers = await authHeaders();

  let url = `${supabaseUrl}/functions/v1/${fnName}`;
  if (options?.path) url += `/${options.path}`;
  if (options?.params) {
    const qs = new URLSearchParams(options.params);
    url += `?${qs.toString()}`;
  }

  const res = await fetch(url, {
    method,
    headers,
    body: options?.body ? JSON.stringify(options.body) : undefined,
  });

  let data: Record<string, unknown>;
  try {
    data = (await res.json()) as Record<string, unknown>;
  } catch {
    throw new Error(`Request failed: ${res.status}`);
  }
  if (!res.ok) {
    const msg =
      (typeof data.error === "string" && data.error) ||
      (typeof data.message === "string" && data.message) ||
      (typeof data.msg === "string" && data.msg) ||
      `Request failed: ${res.status}`;
    throw new Error(msg);
  }
  return data as T;
}

// ── Auth ──
export const auth = {
  signInWithOtp: (phone: string) => supabase.auth.signInWithOtp({ phone }),
  verifyOtp: (phone: string, token: string) =>
    supabase.auth.verifyOtp({ phone, token, type: "sms" }),
  signOut: () => supabase.auth.signOut(),
  getUser: () => supabase.auth.getUser(),
  getSession: () => supabase.auth.getSession(),
  onAuthStateChange: supabase.auth.onAuthStateChange.bind(supabase.auth),
};

// ── KYC ──
export const kyc = {
  verifyBvn: (bvn: string, dateOfBirth?: string) =>
    invoke("kyc-dojah-verify", { body: { level: 2, bvn, dateOfBirth } }),
  verifyNinSelfie: (nin: string, selfieBase64: string) =>
    invoke("kyc-dojah-verify", { body: { level: 3, nin, selfieBase64 } }),
};

// ── Wallet ──
export const wallet = {
  createMonnifyAccount: () => invoke("create-monnify-account"),
  createBlockradarAddress: (network?: string) =>
    invoke("create-blockradar-address", { body: { network } }),
  getWallets: () =>
    invoke("wallets", { method: "GET" }).catch(() => null),
};

// ── Transfers ──
export const transfers = {
  send: (recipientPhone: string, amount: number, currency?: "NGN" | "USDT", description?: string) =>
    invoke("transfer", { body: { recipient_phone: recipientPhone, amount, currency, description } }),
  verifyBankAccount: (bankCode: string, accountNumber: string) =>
    invoke("verify-bank-account", { body: { bank_code: bankCode, account_number: accountNumber } }),
};

// ── Withdrawals ──
export const withdrawals = {
  ngn: (amount: number, bankCode: string, accountNumber: string, accountName: string, narration?: string) =>
    invoke("withdraw-ngn", { body: { amount, bank_code: bankCode, account_number: accountNumber, account_name: accountName, narration } }),
  usdt: (amount: number, address: string, network?: string) =>
    invoke("withdraw-usdt", { body: { amount, address, network } }),
};

// ── Events ──
export const events = {
  list: () => invoke("events", { method: "GET" }),
  getById: (id: string) => invoke("events", { method: "GET", path: id }),
  getByCode: (code: string) => invoke("events", { method: "GET", path: `code/${code}` }),
  create: (data: {
    title: string;
    type: string;
    description?: string;
    location?: string;
    scheduled_start?: string;
    scheduled_end?: string;
    max_participants?: number;
    is_public?: boolean;
  }) => invoke("events", { body: data }),
  update: (id: string, data: Record<string, unknown>) =>
    invoke("events", { method: "PUT", path: id, body: data }),
  goLive: (id: string) => invoke("events", { method: "POST", path: `${id}/go-live` }),
  end: (id: string) => invoke("events", { method: "POST", path: `${id}/end` }),
  join: (id: string) => invoke("events", { method: "POST", path: `${id}/join` }),
  delete: (id: string) => invoke("events", { method: "DELETE", path: id }),
};

// ── Spray ──
export const spray = {
  send: (eventId: string, amount: number, denomination: 200 | 500 | 1000) =>
    invoke("spray", { body: { event_id: eventId, amount, denomination } }),
};

// ── Giveaways ──
export const giveaways = {
  list: () => invoke("giveaway", { method: "GET" }),
  getById: (id: string) => invoke("giveaway", { method: "GET", path: id }),
  getByCode: (code: string) => invoke("giveaway", { method: "GET", path: `code/${code}` }),
  create: (data: { title: string; total_amount: number; per_person_amount: number; type: "live" | "scheduled"; event_id?: string; is_private?: boolean }) =>
    invoke("giveaway", { body: data }),
  redeem: (code: string) => invoke("giveaway", { method: "POST", path: "redeem", body: { code } }),
  stop: (giveawayId: string) => invoke("giveaway", { method: "POST", path: "stop", body: { giveaway_id: giveawayId } }),
};

// ── Notifications ──
export const notifications = {
  list: (unreadOnly?: boolean, limit?: number) =>
    invoke("notifications", { method: "GET", params: { ...(unreadOnly ? { unread: "true" } : {}), ...(limit ? { limit: String(limit) } : {}) } }),
  markRead: (notificationId: string) =>
    invoke("notifications", { body: { notification_id: notificationId } }),
  markAllRead: () =>
    invoke("notifications", { body: { mark_all_read: true } }),
};

// ── Admin ──
export const admin = {
  stats: () => invoke("admin", { method: "GET", path: "stats" }),
  users: {
    list: (params?: { page?: number; limit?: number; status?: string; search?: string }) =>
      invoke("admin", { method: "GET", path: "users", params: params as Record<string, string> }),
    get: (id: string) => invoke("admin", { method: "GET", path: `users/${id}` }),
    suspend: (id: string, reason: string) => invoke("admin", { method: "POST", path: `users/${id}/suspend`, body: { reason } }),
    unsuspend: (id: string) => invoke("admin", { method: "POST", path: `users/${id}/unsuspend` }),
    ban: (id: string, reason: string) => invoke("admin", { method: "POST", path: `users/${id}/ban`, body: { reason } }),
  },
  transactions: {
    list: (params?: { page?: number; limit?: number; status?: string; type?: string; user_id?: string }) =>
      invoke("admin", { method: "GET", path: "transactions", params: params as Record<string, string> }),
    get: (id: string) => invoke("admin", { method: "GET", path: `transactions/${id}` }),
    flag: (id: string, reason: string) => invoke("admin", { method: "POST", path: `transactions/${id}/flag`, body: { reason } }),
  },
  kyc: {
    list: (params?: { page?: number; status?: string }) =>
      invoke("admin", { method: "GET", path: "kyc", params: params as Record<string, string> }),
    approve: (id: string) => invoke("admin", { method: "POST", path: `kyc/${id}/approve` }),
    reject: (id: string, reason: string) => invoke("admin", { method: "POST", path: `kyc/${id}/reject`, body: { reason } }),
  },
  events: {
    list: (params?: { page?: number; status?: string }) =>
      invoke("admin", { method: "GET", path: "events", params: params as Record<string, string> }),
    end: (id: string) => invoke("admin", { method: "POST", path: `events/${id}/end` }),
  },
  team: {
    list: () => invoke("admin", { method: "GET", path: "team" }),
    invite: (email: string, role: string) => invoke("admin", { method: "POST", path: "team/invite", body: { email, role } }),
    disable: (id: string) => invoke("admin", { method: "POST", path: `team/${id}/disable` }),
    enable: (id: string) => invoke("admin", { method: "POST", path: `team/${id}/enable` }),
  },
  audit: (params?: { page?: number; limit?: number }) =>
    invoke("admin", { method: "GET", path: "audit", params: params as Record<string, string> }),
};
