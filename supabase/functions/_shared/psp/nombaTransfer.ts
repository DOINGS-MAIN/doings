import { mapNombaTransferStatus } from "./pspStatus.ts";
import {
  nombaApiRequest,
  nombaBankAccountLookup,
  resolveNombaEnv,
  type NombaEnv,
} from "./nombaClient.ts";
import type { PspEnv, TransferStatusOutcome, TransferSubmitOutcome } from "./types.ts";

function toSubmitOutcome(
  kind: TransferSubmitOutcome["kind"],
  providerStatus: string,
  providerRef: string | null,
  message?: string,
): TransferSubmitOutcome {
  if (kind === "rejected_terminal") {
    return { kind, providerStatus, message: message ?? providerStatus };
  }
  if (kind === "accepted" || kind === "non_terminal") {
    return { kind, providerRef, providerStatus };
  }
  return { kind: "non_terminal", providerRef: null, providerStatus: "UNKNOWN" };
}

export async function nombaSubmitTransfer(input: {
  env: PspEnv;
  reference: string;
  amountNaira: number;
  destinationBankCode: string;
  destinationAccountNumber: string;
  destinationAccountName?: string;
  narration: string;
}): Promise<TransferSubmitOutcome> {
  const nombaEnv: NombaEnv = resolveNombaEnv(input.env);

  let accountName = String(input.destinationAccountName || "").trim();
  if (!accountName) {
    const lookup = await nombaBankAccountLookup({
      env: nombaEnv,
      bankCode: input.destinationBankCode,
      accountNumber: input.destinationAccountNumber,
    });
    if (!lookup.ok) {
      return { kind: "rejected_terminal", providerStatus: "NAME_LOOKUP_FAILED", message: lookup.message };
    }
    accountName = lookup.accountName;
  }

  const { ok, status, json } = await nombaApiRequest({
    env: nombaEnv,
    method: "POST",
    path: "/v2/transfers/bank",
    body: {
      amount: input.amountNaira,
      accountNumber: input.destinationAccountNumber,
      accountName,
      bankCode: input.destinationBankCode,
      merchantTxRef: input.reference,
      senderName: "Doings",
      narration: input.narration.slice(0, 80),
    },
  });

  const data = (json as { data?: { id?: string; status?: string } }).data;
  const providerStatus = String(data?.status || "").toUpperCase();
  const providerRef = data?.id ? String(data.id) : input.reference;

  if (ok || status === 201) {
    const mapped = mapNombaTransferStatus(providerStatus);
    if (mapped.cls === "terminal_success") {
      return toSubmitOutcome("accepted", providerStatus, providerRef);
    }
    if (mapped.cls === "terminal_failure") {
      return toSubmitOutcome(
        "rejected_terminal",
        providerStatus,
        providerRef,
        String((json as { message?: string }).message || providerStatus),
      );
    }
    return toSubmitOutcome("non_terminal", providerStatus, providerRef);
  }

  return { kind: "non_terminal", providerRef, providerStatus: "UNKNOWN" };
}

export async function nombaFetchTransferStatus(input: {
  env: PspEnv;
  reference: string;
}): Promise<TransferStatusOutcome> {
  const nombaEnv = resolveNombaEnv(input.env);
  const q = new URLSearchParams({ transactionRef: input.reference });
  const { ok, json } = await nombaApiRequest({
    env: nombaEnv,
    method: "GET",
    path: `/v1/transactions/accounts/single?${q}`,
  });

  const providerStatus = String((json as { data?: { status?: string } }).data?.status || "").toUpperCase();
  if (!ok) {
    return { normalized: "unknown", providerStatus: "UNKNOWN", providerRef: input.reference, message: "Nomba status query failed" };
  }

  const mapped = mapNombaTransferStatus(providerStatus);
  if (mapped.cls === "terminal_success") {
    return { normalized: "terminal_success", providerStatus, providerRef: input.reference };
  }
  if (mapped.cls === "terminal_failure") {
    return { normalized: "terminal_failure", providerStatus, providerRef: input.reference, message: providerStatus };
  }
  return {
    normalized: "non_terminal",
    providerStatus,
    providerRef: input.reference,
    message: mapped.unmapped ? "unmapped_status" : undefined,
  };
}
