import { monnifyAdapter } from "./adapters/monnify.ts";
import { nombaAdapter } from "./adapters/nomba.ts";
import { flutterwaveAdapter } from "./adapters/flutterwave.ts";
import type {
  BankListItem,
  DisbursementAdapter,
  PspAdapter,
  PspCapability,
  PspEnv,
  SubmitTransferInput,
  TransferStatusOutcome,
  TransferSubmitOutcome,
  WalletFundingAdapter,
} from "./types.ts";

const adapters: PspAdapter[] = [monnifyAdapter, nombaAdapter, flutterwaveAdapter];

const byId = new Map<string, PspAdapter>(adapters.map((a) => [a.id, a]));

export function listAdapters(): PspAdapter[] {
  return [...adapters];
}

export function getAdapter(providerId: string): PspAdapter | undefined {
  return byId.get(providerId);
}

export function requireAdapter(providerId: string): PspAdapter {
  const adapter = getAdapter(providerId);
  if (!adapter) throw new Error(`Unknown PSP provider: ${providerId}`);
  return adapter;
}

export function getWalletFundingAdapter(providerId: string): WalletFundingAdapter {
  const adapter = requireAdapter(providerId);
  if (!adapter.walletFunding) {
    throw new Error(`Provider ${providerId} does not support wallet funding`);
  }
  return adapter.walletFunding;
}

export function getDisbursementAdapter(providerId: string): DisbursementAdapter {
  const adapter = requireAdapter(providerId);
  if (!adapter.disbursement) {
    throw new Error(`Provider ${providerId} does not support disbursement`);
  }
  return adapter.disbursement;
}

export function supportsCapability(providerId: string, capability: PspCapability): boolean {
  const adapter = getAdapter(providerId);
  if (!adapter) return false;
  if (capability === "wallet_funding") return Boolean(adapter.walletFunding);
  if (capability === "disbursement") return Boolean(adapter.disbursement);
  if (capability === "bank_verify") return Boolean(adapter.disbursement?.verifyBankAccount);
  return false;
}

function normalizeBankList(items: BankListItem[]): BankListItem[] {
  const seen = new Set<string>();
  return items
    .map((item) => ({ code: item.code.trim(), name: item.name.trim() }))
    .filter((item) => item.code && item.name)
    .filter((item) => {
      if (seen.has(item.code)) return false;
      seen.add(item.code);
      return true;
    })
    .sort((a, b) => a.name.localeCompare(b.name));
}

export async function listBanks(providerId: string, env: PspEnv): Promise<BankListItem[]> {
  const disbursement = getDisbursementAdapter(providerId);
  const banks = await disbursement.listBanks(env);
  return normalizeBankList(banks);
}

export async function submitTransfer(input: SubmitTransferInput): Promise<TransferSubmitOutcome> {
  const disbursement = getDisbursementAdapter(input.providerId);
  return disbursement.submitTransfer({
    env: input.env,
    reference: input.reference,
    amountNaira: input.amountNaira,
    destinationBankCode: input.destinationBankCode,
    destinationAccountNumber: input.destinationAccountNumber,
    destinationAccountName: input.destinationAccountName,
    narration: input.narration,
  });
}

export async function fetchTransferStatus(
  providerId: string,
  reference: string,
  env: PspEnv,
): Promise<TransferStatusOutcome> {
  const disbursement = getDisbursementAdapter(providerId);
  return disbursement.fetchTransferStatus(reference, env);
}

export async function verifyBankAccount(
  providerId: string,
  bankCode: string,
  accountNumber: string,
  env: PspEnv,
) {
  const disbursement = getDisbursementAdapter(providerId);
  return disbursement.verifyBankAccount(bankCode, accountNumber, env);
}

export async function probeProviderHealth(providerId: string, env: PspEnv = "sandbox") {
  const adapter = requireAdapter(providerId);
  if (!adapter.healthCheck) {
    return { ok: false, message: "Health check not implemented for this provider" };
  }
  return adapter.healthCheck(env);
}
