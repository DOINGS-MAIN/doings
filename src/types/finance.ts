// ==========================================
// Finance Module Types
// Covers KYC, Wallets, Transactions, Providers
// ==========================================

// ---- KYC ----
export type KYCLevel = 0 | 1 | 2 | 3;

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
  selfieVerified: boolean;
}

// KYC level gates
export const KYC_GATES = {
  VIEW_WALLET: 0 as KYCLevel,
  RECEIVE_IN_APP: 1 as KYCLevel,
  FUND_NGN: 2 as KYCLevel,
  RECEIVE_USDT: 2 as KYCLevel,
  SEND_IN_APP: 2 as KYCLevel,
  WITHDRAW_NGN: 3 as KYCLevel,
  WITHDRAW_USDT: 3 as KYCLevel,
} as const;

// ---- Wallet ----
export type Currency = "NGN" | "USDT";

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
  provider?: "monnify" | "blockradar" | "quidax" | "internal";
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

// ---- Provider Configs (mocked) ----
export interface MonnifyReservedAccount {
  accountReference: string;
  accountName: string;
  accountNumber: string;
  bankName: string;
  bankCode: string;
  reservationReference: string;
  status: "ACTIVE" | "INACTIVE";
}

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
  blockradarAddresses: BlockradarAddress[];
  quidaxUser?: QuidaxSubUser;
}
