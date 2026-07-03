import {
  flutterwaveCreateVirtualAccount,
  flutterwaveListBanks,
  flutterwaveResolveBankAccount,
  getFlutterwaveSetupStatus,
} from "../flutterwaveClient.ts";
import { flutterwaveFetchTransferStatus, flutterwaveSubmitTransfer } from "../flutterwaveTransfer.ts";
import type {
  DisbursementAdapter,
  HealthProbeResult,
  PspAdapter,
  PspEnv,
  VirtualAccountResult,
  WalletFundingAdapter,
} from "../types.ts";

export function stableFlutterwaveAccountRef(userId: string): string {
  return `doings-fw-${userId}`;
}

const walletFunding: WalletFundingAdapter = {
  async createVirtualAccount(params) {
    const bvn = params.bvn.replace(/\D/g, "");
    if (bvn.length !== 11) {
      throw new Error("Valid 11-digit BVN is required for Flutterwave virtual accounts");
    }
    const txRef = stableFlutterwaveAccountRef(params.userId);
    const created = await flutterwaveCreateVirtualAccount({
      txRef,
      email: params.email,
      userName: params.userName,
      bvn,
    });
    return {
      accountNumber: created.accountNumber,
      accountName: created.accountName,
      bankName: created.bankName,
      bankCode: created.bankCode,
      accountReference: created.accountReference,
      reservationReference: created.accountReference,
    } satisfies VirtualAccountResult;
  },
};

const disbursement: DisbursementAdapter = {
  listBanks: async () => flutterwaveListBanks(),
  async verifyBankAccount(bankCode, accountNumber, _env) {
    const lookup = await flutterwaveResolveBankAccount({ bankCode, accountNumber });
    if (!lookup.ok) throw new Error(lookup.message);
    return { accountName: lookup.accountName };
  },
  submitTransfer: flutterwaveSubmitTransfer,
  fetchTransferStatus: (reference, _env) => flutterwaveFetchTransferStatus({ reference }),
};

async function healthCheck(_env: PspEnv): Promise<HealthProbeResult> {
  const setup = getFlutterwaveSetupStatus();
  if (!setup.configured) {
    return { ok: false, message: "Missing Flutterwave credentials (FLUTTERWAVE_SECRET_KEY)" };
  }
  return {
    ok: true,
    message: "Flutterwave credentials configured",
    details: setup,
  };
}

export const flutterwaveAdapter: PspAdapter = {
  id: "flutterwave",
  displayName: "Flutterwave",
  walletFunding,
  disbursement,
  healthCheck,
};
