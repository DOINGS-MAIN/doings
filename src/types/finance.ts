// ==========================================
// Finance Module Types
// Covers KYC, Wallets, Transactions, Providers
// ==========================================

// ---- KYC ----
export type KYCLevel = 0 | 1 | 2;

export type KYCStatus = "none" | "pending" | "verified" | "rejected";

export interface KYCVerification {
  level: KYCLevel;
  status: KYCStatus;
  provider: "dojah";
  providerRef?: string;
  verifiedAt?: Date;
  submittedAt?: Date;
  data?: Record<string, unknown>;
}

export interface KYCState {
  currentLevel: KYCLevel;
  verifications: KYCVerification[];
  personalInfo?: {
    fullName: string;
    phone: string;
    email: string;
    dateOfBirth: string;
    address: string;
  };
  bvnVerified: boolean;
  bvnData?: {
    bvn: string;
    firstName: string;
    lastName: string;
    phoneNumber: string;
    dateOfBirth: string;
  };
  ninVerified: boolean;
}

export interface WithdrawalFeeSettings {
  platformFeePercent: number;
  transactionFeeNaira: number;
}

export interface FxPublicSettings {
  enabled: boolean;
  market_rate_kobo: number | null;
  market_rate_naira: number | null;
  market_rate_updated_at: string | null;
  sell_rate_kobo: number | null;
  buy_rate_kobo: number | null;
  sell_rate_naira: number | null;
  buy_rate_naira: number | null;
  sell_platform_fee_percent: number;
  buy_platform_fee_percent: number;
  min_trade_usdc: number;
  quote_ttl_seconds: number;
}

export interface FxQuote {
  quote_id: string;
  side: "sell" | "buy";
  usdc_micro: number;
  usdc: number;
  ngn_gross_kobo: number;
  fee_kobo: number;
  ngn_net_kobo: number;
  ngn_gross: number;
  fee_naira: number;
  ngn_net: number;
  market_rate_kobo: number;
  market_rate_naira: number;
  effective_rate_kobo: number;
  effective_rate_naira: number;
  platform_fee_percent: number;
  expires_at: string;
  ttl_seconds: number;
}

export interface FxAdminSettings extends FxPublicSettings {
  rate_source: "binance" | "bybit" | "paycrest" | "manual";
  sell_flat_kobo: number;
  sell_flat_naira: number;
  sell_percent: number;
  buy_flat_kobo: number;
  buy_flat_naira: number;
  buy_percent: number;
  daily_cap_usdc: number;
}

export interface TreasuryBalances {
  ngn_balance: number;
  ngn_balance_naira: number;
  usdc_balance_micro: number;
  usdc_balance: number;
}

// KYC level gates
export const KYC_GATES = {
  VIEW_WALLET: 0 as KYCLevel,
  RECEIVE_IN_APP: 1 as KYCLevel,
  FUND_NGN: 2 as KYCLevel,
  RECEIVE_USDC: 2 as KYCLevel,
  SEND_IN_APP: 2 as KYCLevel,
  WITHDRAW_NGN: 2 as KYCLevel,
  WITHDRAW_USDC: 2 as KYCLevel,
  CONVERT: 2 as KYCLevel,
  SPRAY: 2 as KYCLevel,
} as const;

// ---- Wallet ----
export type Currency = "NGN" | "USDC";

export interface Wallet {
  id: string;
  currency: Currency;
  balance: number;
  lockedBalance: number;
  addresses: WalletAddress[];
  createdAt: Date;
}

export interface WalletAddress {
  id: string;
  provider: "monnify" | "blockradar" | "quidax";
  address: string;
  label: string;
  network?: string; // e.g. "TRC20", "BEP20", "ERC20"
  metadata?: Record<string, unknown>;
  createdAt: Date;
}

// ---- Transactions ----
export type TransactionType =
  | "deposit"
  | "withdrawal"
  | "send"
  | "receive"
  | "spray"
  | "giveaway"
  | "swap";

export type TransactionStatus = "pending" | "processing" | "completed" | "failed";

export interface FinanceTransaction {
  id: string;
  walletId: string;
  currency: Currency;
  type: TransactionType;
  amount: number; // positive = credit, negative = debit
  fee: number;
  netAmount: number;
  status: TransactionStatus;
  provider?: "monnify" | "nomba" | "flutterwave" | "blockradar" | "quidax" | "internal";
  providerRef?: string;
  idempotencyKey: string;
  description: string;
  metadata?: Record<string, unknown>;
  createdAt: Date;
  completedAt?: Date;
}

// ---- Bank Accounts (for NGN payouts) ----
export interface BankAccountInfo {
  id: string;
  bankCode: string;
  bankName: string;
  accountNumber: string;
  accountName: string;
  isDefault: boolean;
  isVerified: boolean;
  createdAt: Date;
}

// ---- Provider Configs ----
export interface MonnifyReservedAccount {
  accountReference: string;
  accountName: string;
  accountNumber: string;
  bankName: string;
  bankCode: string;
  reservationReference: string;
  status: "ACTIVE" | "INACTIVE";
  providerId?: string;
}

/** Provider-agnostic NGN funding account (Monnify, Nomba, etc.) */
export type NgnReservedAccount = MonnifyReservedAccount;

export interface BlockradarAddress {
  address: string;
  network: string;
  blockchain: string;
  walletId: string;
}

export interface QuidaxSubUser {
  id: string;
  email: string;
  walletAddress?: string;
  network?: string;
}

// ---- Multi-wallet State ----
export interface MultiWalletState {
  wallets: Record<Currency, Wallet>;
  transactions: FinanceTransaction[];
  monnifyAccount?: MonnifyReservedAccount;
  ngnReservedAccount?: NgnReservedAccount;
  blockradarAddresses: BlockradarAddress[];
  quidaxUser?: QuidaxSubUser;
}
