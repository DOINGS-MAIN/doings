export type PspCapability = "wallet_funding" | "disbursement" | "bank_verify";

export type PspEnv = "sandbox" | "production";

export type NormalizedStatus = "terminal_success" | "terminal_failure" | "non_terminal" | "unknown";

export type VirtualAccountResult = {
  accountNumber: string;
  accountName: string;
  bankName: string;
  bankCode: string;
  accountReference: string;
  reservationReference: string;
};

export type BankAccountResult = {
  accountName: string;
};

export type BankListItem = {
  code: string;
  name: string;
};

export type TransferSubmitOutcome =
  | { kind: "accepted"; providerRef: string; providerStatus: string }
  | { kind: "non_terminal"; providerRef: string; providerStatus: string }
  | { kind: "rejected_terminal"; providerStatus: string; message: string }
  | { kind: "unknown"; providerStatus: string; message: string };

export type TransferStatusOutcome = {
  normalized: NormalizedStatus;
  providerStatus: string;
  providerRef?: string;
  message?: string;
};

export type HealthProbeResult = {
  ok: boolean;
  message: string;
  details?: Record<string, unknown>;
};

export type WalletFundingAdapter = {
  createVirtualAccount(params: {
    userId: string;
    userName: string;
    email: string;
    bvn: string;
    nin?: string;
  }): Promise<VirtualAccountResult>;
};

export type DisbursementAdapter = {
  listBanks(env: PspEnv): Promise<BankListItem[]>;
  verifyBankAccount(bankCode: string, accountNumber: string, env: PspEnv): Promise<BankAccountResult>;
  submitTransfer(params: {
    env: PspEnv;
    reference: string;
    amountNaira: number;
    destinationBankCode: string;
    destinationAccountNumber: string;
    destinationAccountName: string;
    narration: string;
  }): Promise<TransferSubmitOutcome>;
  fetchTransferStatus(reference: string, env: PspEnv): Promise<TransferStatusOutcome>;
};

export type PspAdapter = {
  id: string;
  displayName: string;
  walletFunding?: WalletFundingAdapter;
  disbursement?: DisbursementAdapter;
  healthCheck?(env: PspEnv): Promise<HealthProbeResult>;
};

export type SubmitTransferInput = {
  providerId: string;
  env: PspEnv;
  reference: string;
  amountNaira: number;
  destinationBankCode: string;
  destinationAccountNumber: string;
  destinationAccountName: string;
  narration: string;
};

export type PspEventInput = {
  transactionId?: string | null;
  providerId: string;
  direction: "inbound" | "outbound";
  eventType: string;
  status?: string | null;
  providerStatus?: string | null;
  reference?: string | null;
  providerRef?: string | null;
  requestSummary?: Record<string, unknown> | null;
  responseSummary?: Record<string, unknown> | null;
  errorMessage?: string | null;
};
