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
  params?: Record<string, string | number | boolean | undefined | null>;
  path?: string;
}): Promise<T> {
  const method = options?.method ?? "POST";
  const headers = await authHeaders();

  let url = `${supabaseUrl}/functions/v1/${fnName}`;
  if (options?.path) url += `/${options.path}`;
  if (options?.params) {
    const qs = new URLSearchParams();
    for (const [key, value] of Object.entries(options.params)) {
      if (value === undefined || value === null || value === "") continue;
      qs.set(key, String(value));
    }
    const query = qs.toString();
    if (query) url += `?${query}`;
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
    const detail = typeof data.detail === "string" ? data.detail : "";
    const msg =
      (typeof data.error === "string" && data.error) ||
      (typeof data.message === "string" && data.message) ||
      (typeof data.msg === "string" && data.msg) ||
      `Request failed: ${res.status}`;
    const err = new Error(detail ? `${msg}: ${detail}` : msg) as Error & { code?: string };
    if (typeof data.code === "string") err.code = data.code;
    throw err;
  }
  return data as T;
}

async function downloadAdminCsv(path: string, params?: Record<string, string>): Promise<void> {
  const headers = await authHeaders();
  const qs = new URLSearchParams({ ...(params ?? {}), format: "csv" });
  const url = `${supabaseUrl}/functions/v1/admin/${path}?${qs.toString()}`;
  const res = await fetch(url, { method: "GET", headers });
  if (!res.ok) {
    let message = `Export failed: ${res.status}`;
    try {
      const data = (await res.json()) as { error?: string };
      if (data.error) message = data.error;
    } catch {
      // ignore
    }
    throw new Error(message);
  }
  const blob = await res.blob();
  const filename = path.replace(/\//g, "-") + ".csv";
  const objectUrl = URL.createObjectURL(blob);
  const anchor = document.createElement("a");
  anchor.href = objectUrl;
  anchor.download = filename;
  anchor.click();
  URL.revokeObjectURL(objectUrl);
}

// ── Auth ──
export const auth = {
  signInWithPassword: (email: string, password: string) =>
    supabase.auth.signInWithPassword({
      email: email.trim().toLowerCase(),
      password,
    }),
  signUpWithPassword: (
    email: string,
    password: string,
    firstName: string,
    lastName: string,
    username: string
  ) => {
    const fn = firstName.trim();
    const ln = lastName.trim();
    const origin = typeof window !== "undefined" ? window.location.origin : "";
    return supabase.auth.signUp({
      email: email.trim().toLowerCase(),
      password,
      options: {
        emailRedirectTo: origin ? `${origin}/auth/callback` : undefined,
        data: {
          first_name: fn,
          last_name: ln,
          username: username.trim().toLowerCase(),
          full_name: `${fn} ${ln}`.trim(),
        },
      },
    });
  },
  resetPasswordForEmail: (email: string) => {
    const origin = typeof window !== "undefined" ? window.location.origin : "";
    if (!origin) {
      return Promise.resolve({ data: {}, error: new Error("Password reset is only available in the browser.") });
    }
    return supabase.auth.resetPasswordForEmail(email.trim().toLowerCase(), {
      redirectTo: `${origin}/auth/reset-password`,
    });
  },
  resendSignupEmail: (email: string) =>
    supabase.auth.resend({
      type: "signup",
      email: email.trim().toLowerCase(),
      options: {
        emailRedirectTo:
          typeof window !== "undefined" ? `${window.location.origin}/auth/callback` : undefined,
      },
    }),
  updatePassword: (newPassword: string) => supabase.auth.updateUser({ password: newPassword }),
  signInWithGoogle: (redirectTo: string) =>
    supabase.auth.signInWithOAuth({
      provider: "google",
      options: { redirectTo },
    }),
  signOut: () => supabase.auth.signOut(),
  getUser: () => supabase.auth.getUser(),
  getSession: () => supabase.auth.getSession(),
  onAuthStateChange: supabase.auth.onAuthStateChange.bind(supabase.auth),
};

// ── KYC ──
export const kyc = {
  /** Dojah BVN + NIN (no selfie); on success server also provisions Monnify reserved account when missing. */
  verifyBvnAndNin: (bvn: string, nin: string, dateOfBirth?: string) =>
    invoke("kyc-dojah-verify", { body: { bvn, nin, dateOfBirth } }),
};

// ── Wallet ──
export const wallet = {
  createNgnAccount: (bvn?: string, nin?: string) =>
    invoke("create-ngn-account", { body: { ...(bvn ? { bvn } : {}), ...(nin ? { nin } : {}) } }),
  /** @deprecated Use createNgnAccount */
  createMonnifyAccount: (bvn: string) => invoke("create-monnify-account", { body: { bvn } }),
  createBlockradarAddress: (network?: string) =>
    invoke("create-blockradar-address", { body: { network } }),
  getWalletFundingProvider: () => supabase.rpc("get_wallet_funding_provider"),
  getWithdrawalFeeSettings: () => supabase.rpc("get_withdrawal_fee_settings"),
  getWallets: () =>
    invoke("wallets", { method: "GET" }).catch(() => null),
};

// ── Transfers ──
export const transfers = {
  lookupUser: (username: string) =>
    invoke("lookup-user", { method: "GET", params: { username } }),
  recentRecipients: () =>
    invoke("lookup-user", { method: "GET", params: { recent: "true" } }),
  send: (recipientUsername: string, amountNaira: number, pin: string, currency?: "NGN" | "USDC", description?: string) =>
    invoke("transfer", {
      body: { recipient_username: recipientUsername, amount: amountNaira, pin, currency, description },
    }),
  listBanks: () => invoke("list-banks", { method: "GET" }),
  verifyBankAccount: (bankCode: string, accountNumber: string) =>
    invoke("verify-bank-account", { body: { bank_code: bankCode, account_number: accountNumber } }),
};

// ── FX / Convert ──
export const fx = {
  getSettings: () => invoke("fx-quote", { method: "GET" }),
  createQuote: (side: "sell" | "buy", usdcAmount: number) =>
    invoke("fx-quote", { body: { side, usdc_amount: usdcAmount } }),
  convert: (quoteId: string, pin: string) =>
    invoke("fx-convert", { body: { quote_id: quoteId, pin } }),
};

// ── Withdrawals ──
export const withdrawals = {
  ngn: (amount: number, bankCode: string, accountNumber: string, accountName: string, pin: string, narration?: string) =>
    invoke("withdraw-ngn", {
      body: {
        amount,
        bank_code: bankCode,
        account_number: accountNumber,
        account_name: accountName,
        pin,
        narration,
      },
    }),
  usdc: (amount: number, address: string, pin: string, network?: string) =>
    invoke("withdraw-usdc", { body: { amount, address, pin, network } }),
};

export const transactionPin = {
  has: () => supabase.rpc("has_transaction_pin"),
  set: (pin: string, currentPin?: string) =>
    supabase.rpc("set_transaction_pin", { p_pin: pin, p_current_pin: currentPin ?? null }),
};

export const profileApi = {
  isUsernameAvailable: (username: string) =>
    supabase.rpc("is_username_available", { p_username: username }),
  setUsername: (username: string) => supabase.rpc("set_username", { p_username: username }),
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
  validate: (eventId: string, amount: number, denomination: 200 | 500 | 1000, pin: string) =>
    invoke("spray", { body: { event_id: eventId, amount, denomination, pin, validate_only: true } }),
  send: (eventId: string, amount: number, denomination: 200 | 500 | 1000, pin: string) =>
    invoke("spray", { body: { event_id: eventId, amount, denomination, pin } }),
};

// ── Giveaways ──
export const giveaways = {
  list: () => invoke("giveaway", { method: "GET" }),
  getById: (id: string) => invoke("giveaway", { method: "GET", path: id }),
  getByCode: (code: string) => invoke("giveaway", { method: "GET", path: `code/${code}` }),
  create: (data: {
    title: string;
    /** Naira (major units); server converts to kobo */
    total_amount: number;
    per_person_amount: number;
    type: "live" | "scheduled";
    event_id?: string;
    is_private?: boolean;
    show_on_event_screen?: boolean;
    pin: string;
  }) => invoke("giveaway", { body: data }),
  redeem: (code: string) => invoke("giveaway", { method: "POST", path: "redeem", body: { code } }),
  stop: (giveawayId: string, pin: string) =>
    invoke("giveaway", { method: "POST", path: "stop", body: { giveaway_id: giveawayId, pin } }),
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
    list: (params?: {
      page?: number;
      limit?: number;
      status?: string;
      type?: string;
      user_id?: string;
      provider?: string;
      currency?: string;
      flagged?: string;
      search?: string;
      date_from?: string;
      date_to?: string;
    }) => invoke("admin", { method: "GET", path: "transactions", params: params as Record<string, string> }),
    get: (id: string) => invoke("admin", { method: "GET", path: `transactions/${id}` }),
    flag: (id: string, reason: string) => invoke("admin", { method: "POST", path: `transactions/${id}/flag`, body: { reason } }),
    unflag: (id: string) => invoke("admin", { method: "POST", path: `transactions/${id}/unflag` }),
    refund: (id: string, reason?: string) => invoke("admin", { method: "POST", path: `transactions/${id}/refund`, body: { reason } }),
    exportCsv: (params?: Record<string, string>) =>
      downloadAdminCsv("transactions", params),
  },
  payments: {
    overview: () => invoke("admin", { method: "GET", path: "payments" }),
  },
  queue: () => invoke("admin", { method: "GET", path: "queue" }),
  pspEvents: {
    list: (params?: { page?: number; limit?: number; provider?: string; direction?: string; search?: string }) =>
      invoke("admin", { method: "GET", path: "psp-events", params: params as Record<string, string> }),
    exportCsv: (params?: Record<string, string>) => downloadAdminCsv("psp-events", params),
  },
  webhooks: {
    list: (params?: {
      page?: number;
      limit?: number;
      provider?: string;
      processed?: string;
      event_type?: string;
      search?: string;
    }) => invoke("admin", { method: "GET", path: "webhooks", params: params as Record<string, string> }),
    get: (id: string) => invoke("admin", { method: "GET", path: `webhooks/${id}` }),
    reprocess: (id: string) => invoke("admin", { method: "POST", path: `webhooks/${id}/reprocess` }),
    exportCsv: (params?: Record<string, string>) => downloadAdminCsv("webhooks", params),
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
  paymentRails: {
    get: () => invoke("admin", { method: "GET", path: "payment-rails" }),
    health: (providerId: string) => invoke("admin", { method: "GET", path: `payment-rails/health/${providerId}` }),
    setFundingProvider: (providerId: string) =>
      supabase.rpc("set_wallet_funding_provider", { _provider_id: providerId }),
    setDisbursementProvider: (providerId: string) =>
      supabase.rpc("set_disbursement_provider", { _provider_id: providerId }),
    setPspEnv: (pspEnv: "sandbox" | "production") =>
      supabase.rpc("set_psp_env", { _psp_env: pspEnv }),
    getWithdrawalFees: () => supabase.rpc("get_withdrawal_fee_settings"),
    setWithdrawalFees: (platformFeePercent: number, transactionFeeNaira: number) =>
      supabase.rpc("set_withdrawal_fee_settings", {
        _platform_fee_percent: platformFeePercent,
        _transaction_fee_kobo: Math.round(transactionFeeNaira * 100),
      }),
    probeAll: () => invoke("admin", { method: "POST", path: "payment-rails/probe-all" }),
  },
  fx: {
    getSettings: () => supabase.rpc("get_fx_admin_settings"),
    setSettings: (payload: {
      enabled: boolean;
      rateSource: "binance" | "bybit" | "paycrest" | "manual";
      sellFlatNaira: number;
      sellPercent: number;
      buyFlatNaira: number;
      buyPercent: number;
      sellPlatformFeePercent: number;
      buyPlatformFeePercent: number;
      dailyCapUsdc: number;
      minTradeUsdc: number;
      quoteTtlSeconds: number;
    }) =>
      supabase.rpc("set_fx_settings", {
        _enabled: payload.enabled,
        _rate_source: payload.rateSource,
        _sell_flat_kobo: Math.round(payload.sellFlatNaira * 100),
        _sell_percent: payload.sellPercent,
        _buy_flat_kobo: Math.round(payload.buyFlatNaira * 100),
        _buy_percent: payload.buyPercent,
        _sell_platform_fee_percent: payload.sellPlatformFeePercent,
        _buy_platform_fee_percent: payload.buyPlatformFeePercent,
        _daily_cap_usdc_micro: Math.round(payload.dailyCapUsdc * 1_000_000),
        _min_trade_usdc_micro: Math.round(payload.minTradeUsdc * 1_000_000),
        _quote_ttl_seconds: payload.quoteTtlSeconds,
      }),
    getTreasuryBalances: () => supabase.rpc("get_treasury_balances"),
    recordTopup: (currency: "NGN" | "USDC", amount: number, reference?: string, note?: string) => {
      const smallest = currency === "NGN" ? Math.round(amount * 100) : Math.round(amount * 1_000_000);
      return supabase.rpc("record_treasury_topup", {
        p_currency: currency,
        p_amount: smallest,
        p_reference: reference ?? null,
        p_note: note ?? null,
      });
    },
    refreshRate: () => invoke("fx-rates", { method: "POST" }),
    setManualRate: (marketRateNaira: number) =>
      supabase.rpc("set_fx_market_rate_manual", { p_market_rate_naira: marketRateNaira }),
  },
};
