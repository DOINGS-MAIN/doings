import { mapFlutterwaveTransferStatus } from "./pspStatus.ts";
import { flutterwaveApiRequest, flutterwaveResolveBankAccount } from "./flutterwaveClient.ts";
import type { PspEnv, TransferStatusOutcome, TransferSubmitOutcome } from "./types.ts";

export async function flutterwaveSubmitTransfer(input: {
  env: PspEnv;
  reference: string;
  amountNaira: number;
  destinationBankCode: string;
  destinationAccountNumber: string;
  destinationAccountName?: string;
  narration: string;
}): Promise<TransferSubmitOutcome> {
  let accountName = String(input.destinationAccountName || "").trim();
  if (!accountName) {
    const lookup = await flutterwaveResolveBankAccount({
      bankCode: input.destinationBankCode,
      accountNumber: input.destinationAccountNumber,
    });
    if (!lookup.ok) {
      return { kind: "rejected_terminal", providerStatus: "NAME_LOOKUP_FAILED", message: lookup.message };
    }
    accountName = lookup.accountName;
  }

  const { ok, status, json } = await flutterwaveApiRequest({
    method: "POST",
    path: "/transfers",
    body: {
      account_bank: input.destinationBankCode,
      account_number: input.destinationAccountNumber,
      amount: input.amountNaira,
      narration: input.narration.slice(0, 80),
      currency: "NGN",
      reference: input.reference,
      beneficiary_name: accountName,
      debit_currency: "NGN",
      ...(Deno.env.get("FLUTTERWAVE_TRANSFER_CALLBACK_URL")
        ? { callback_url: Deno.env.get("FLUTTERWAVE_TRANSFER_CALLBACK_URL") }
        : {}),
    },
  });

  const data = (json as { data?: { id?: number; reference?: string; status?: string; complete_message?: string } }).data;
  const providerStatus = String(data?.status || "").toUpperCase();
  const providerRef = data?.id != null ? String(data.id) : (data?.reference || input.reference);

  if (ok || status === 200) {
    const mapped = mapFlutterwaveTransferStatus(providerStatus);
    if (mapped.cls === "terminal_success") {
      return { kind: "accepted", providerRef, providerStatus };
    }
    if (mapped.cls === "terminal_failure") {
      return {
        kind: "rejected_terminal",
        providerStatus,
        message: String(data?.complete_message || (json as { message?: string }).message || providerStatus),
      };
    }
    return { kind: "non_terminal", providerRef, providerStatus };
  }

  const message = String((json as { message?: string }).message || "Flutterwave transfer failed");
  return { kind: "rejected_terminal", providerStatus: providerStatus || "FAILED", message };
}

export async function flutterwaveFetchTransferStatus(input: {
  reference: string;
}): Promise<TransferStatusOutcome> {
  const q = new URLSearchParams({ reference: input.reference });
  const { ok, json } = await flutterwaveApiRequest({
    method: "GET",
    path: `/transfers?${q}`,
  });

  const list = (json as { data?: Array<{ id?: number; status?: string; reference?: string }> }).data;
  const row = Array.isArray(list) ? list[0] : undefined;
  const providerStatus = String(row?.status || "").toUpperCase();
  const providerRef = row?.id != null ? String(row.id) : input.reference;

  if (!ok || !row) {
    return {
      normalized: "unknown",
      providerStatus: "UNKNOWN",
      providerRef: input.reference,
      message: "Flutterwave transfer status query failed",
    };
  }

  const mapped = mapFlutterwaveTransferStatus(providerStatus);
  if (mapped.cls === "terminal_success") {
    return { normalized: "terminal_success", providerStatus, providerRef };
  }
  if (mapped.cls === "terminal_failure") {
    return { normalized: "terminal_failure", providerStatus, providerRef, message: providerStatus };
  }
  return {
    normalized: "non_terminal",
    providerStatus,
    providerRef,
    message: mapped.unmapped ? "unmapped_status" : undefined,
  };
}
