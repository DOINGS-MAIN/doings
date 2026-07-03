import { createReservedAccount } from "../../monnify.ts";
import {
  monnifyFetchTransferStatus,
  monnifyListBanks,
  monnifySubmitTransfer,
  monnifyValidateBankAccount,
} from "../monnifyTransfer.ts";
import { mapMonnifyStatus } from "../pspStatus.ts";
import type {
  DisbursementAdapter,
  HealthProbeResult,
  PspAdapter,
  PspEnv,
  TransferStatusOutcome,
  TransferSubmitOutcome,
  WalletFundingAdapter,
} from "../types.ts";

function toStatusOutcome(result: Awaited<ReturnType<typeof monnifyFetchTransferStatus>>): TransferStatusOutcome {
  if (result.kind === "terminal_success") {
    return { normalized: "terminal_success", providerStatus: result.providerStatus, rawBody: result.rawBody };
  }
  if (result.kind === "terminal_failure") {
    return { normalized: "terminal_failure", providerStatus: result.providerStatus, message: result.providerStatus };
  }
  if (result.kind === "non_terminal") {
    return {
      normalized: "non_terminal",
      providerStatus: result.providerStatus,
      message: result.unmapped ? "unmapped_status" : undefined,
    };
  }
  return { normalized: "unknown", providerStatus: "UNKNOWN", message: result.message };
}

const walletFunding: WalletFundingAdapter = {
  createVirtualAccount: createReservedAccount,
};

const disbursement: DisbursementAdapter = {
  listBanks: (env) => monnifyListBanks(env),
  async verifyBankAccount(bankCode, accountNumber, env) {
    const result = await monnifyValidateBankAccount({ env, bankCode, accountNumber });
    if (!result.ok) throw new Error(result.message);
    return { accountName: result.accountName };
  },
  async submitTransfer(params): Promise<TransferSubmitOutcome> {
    const result = await monnifySubmitTransfer({
      env: params.env,
      reference: params.reference,
      amountNaira: params.amountNaira,
      destinationBankCode: params.destinationBankCode,
      destinationAccountNumber: params.destinationAccountNumber,
      destinationAccountName: params.destinationAccountName,
      narration: params.narration,
    });

    if (result.kind === "rejected_terminal") {
      return { kind: "rejected_terminal", providerStatus: result.providerStatus, message: result.message };
    }
    if (result.kind === "unknown") {
      return { kind: "non_terminal", providerRef: null, providerStatus: "UNKNOWN" };
    }

    const mapped = mapMonnifyStatus(result.providerStatus);
    if (mapped.cls === "terminal_success") {
      return { kind: "accepted", providerRef: result.providerRef, providerStatus: result.providerStatus };
    }
    if (mapped.cls === "terminal_failure") {
      return { kind: "rejected_terminal", providerStatus: result.providerStatus, message: result.providerStatus };
    }
    return { kind: "non_terminal", providerRef: result.providerRef, providerStatus: result.providerStatus };
  },
  async fetchTransferStatus(reference, env): Promise<TransferStatusOutcome> {
    const result = await monnifyFetchTransferStatus({ env, reference });
    return {
      ...toStatusOutcome(result),
      providerRef: reference,
    };
  },
};

async function healthCheck(_env: PspEnv): Promise<HealthProbeResult> {
  const hasKeys = Boolean(Deno.env.get("MONNIFY_API_KEY") && Deno.env.get("MONNIFY_SECRET_KEY"));
  const hasContract = Boolean(Deno.env.get("MONNIFY_CONTRACT_CODE"));
  const hasSource = Boolean(
    Deno.env.get("MONNIFY_DISBURSEMENT_SOURCE_ACCOUNT") || Deno.env.get("MONNIFY_SOURCE_ACCOUNT"),
  );

  if (!hasKeys) {
    return { ok: false, message: "Missing MONNIFY_API_KEY or MONNIFY_SECRET_KEY" };
  }

  return {
    ok: true,
    message: "Monnify credentials configured",
    details: {
      contract_configured: hasContract,
      disbursement_source_configured: hasSource,
    },
  };
}

export const monnifyAdapter: PspAdapter = {
  id: "monnify",
  displayName: "Monnify",
  walletFunding,
  disbursement,
  healthCheck,
};
