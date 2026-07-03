import { nombaBankAccountLookup, nombaCreateVirtualAccount, nombaListBanks, getNombaSetupStatus, resolveNombaEnv } from "../nombaClient.ts";
import { nombaFetchTransferStatus, nombaSubmitTransfer } from "../nombaTransfer.ts";
import type {
  DisbursementAdapter,
  HealthProbeResult,
  PspAdapter,
  PspEnv,
  VirtualAccountResult,
  WalletFundingAdapter,
} from "../types.ts";

function stableNombaAccountRef(userId: string): string {
  return `doings-nomba-${userId}`;
}

const walletFunding: WalletFundingAdapter = {
  async createVirtualAccount(params) {
    const env = resolveNombaEnv("sandbox");
    const accountRef = stableNombaAccountRef(params.userId);
    const result = await nombaCreateVirtualAccount({
      env,
      accountRef,
      accountName: `DOINGS/${params.userName}`.slice(0, 90),
    });
    return {
      accountNumber: result.accountNumber,
      accountName: result.accountName,
      bankName: result.bankName,
      bankCode: "",
      accountReference: result.accountReference,
      reservationReference: result.accountReference,
    } satisfies VirtualAccountResult;
  },
};

const disbursement: DisbursementAdapter = {
  listBanks: (env) => nombaListBanks(resolveNombaEnv(env)),
  async verifyBankAccount(bankCode, accountNumber, env) {
    const lookup = await nombaBankAccountLookup({
      env: resolveNombaEnv(env),
      bankCode,
      accountNumber,
    });
    if (!lookup.ok) throw new Error(lookup.message);
    return { accountName: lookup.accountName };
  },
  submitTransfer: nombaSubmitTransfer,
  fetchTransferStatus: nombaFetchTransferStatus,
};

async function healthCheck(env: PspEnv): Promise<HealthProbeResult> {
  const setup = getNombaSetupStatus();
  if (!setup.configured) {
    return { ok: false, message: "Missing Nomba credentials (NOMBA_CLIENT_ID, NOMBA_CLIENT_SECRET, NOMBA_ACCOUNT_ID)" };
  }
  return {
    ok: true,
    message: "Nomba credentials configured",
    details: { ...setup, resolved_env: resolveNombaEnv(env) },
  };
}

export const nombaAdapter: PspAdapter = {
  id: "nomba",
  displayName: "Nombank (Nomba)",
  walletFunding,
  disbursement,
  healthCheck,
};

export { stableNombaAccountRef };
