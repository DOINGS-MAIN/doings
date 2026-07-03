import type { SupabaseClient } from "https://esm.sh/@supabase/supabase-js@2.49.8";
import { createReservedAccount } from "../monnify.ts";
import { getWalletFundingAdapter } from "./registry.ts";
import { getPlatformPaymentSettings } from "./platformSettings.ts";
import { nombaCreateVirtualAccount, resolveNombaEnv, getNombaSetupStatus } from "./nombaClient.ts";
import { stableNombaAccountRef } from "./adapters/nomba.ts";

export type ReservedAccountRow = {
  accountReference: string;
  accountName: string;
  accountNumber: string;
  bankName: string;
  bankCode: string;
  reservationReference: string;
  providerId: string;
};

export async function getExistingReservedAccount(
  supabase: SupabaseClient,
  userId: string,
  providerId: string,
): Promise<ReservedAccountRow | null> {
  const { data } = await supabase
    .from("reserved_accounts")
    .select("account_reference, account_name, account_number, bank_name, bank_code, reservation_reference, provider_id")
    .eq("user_id", userId)
    .eq("provider_id", providerId)
    .limit(1)
    .maybeSingle();

  if (!data) return null;
  return {
    accountReference: data.account_reference,
    accountName: data.account_name,
    accountNumber: data.account_number,
    bankName: data.bank_name,
    bankCode: data.bank_code,
    reservationReference: data.reservation_reference ?? data.account_reference,
    providerId: data.provider_id,
  };
}

export async function provisionReservedAccount(
  supabase: SupabaseClient,
  input: {
    userId: string;
    userName: string;
    email: string;
    walletId: string;
    bvn?: string;
    nin?: string;
    providerId?: string;
  },
): Promise<ReservedAccountRow> {
  const platform = await getPlatformPaymentSettings(supabase);
  const providerId = input.providerId ?? platform.walletFundingProviderId;

  const existing = await getExistingReservedAccount(supabase, input.userId, providerId);
  if (existing) return existing;

  let account: Omit<ReservedAccountRow, "providerId">;

  if (providerId === "nomba") {
    if (!getNombaSetupStatus().configured) {
      throw new Error("Nomba API credentials not configured");
    }
    const nombaEnv = resolveNombaEnv(platform.pspEnv);
    const created = await nombaCreateVirtualAccount({
      env: nombaEnv,
      accountRef: stableNombaAccountRef(input.userId),
      accountName: `DOINGS/${input.userName}`.slice(0, 90),
    });
    account = {
      accountReference: created.accountReference,
      accountName: created.accountName,
      accountNumber: created.accountNumber,
      bankName: created.bankName,
      bankCode: "",
      reservationReference: created.accountReference,
    };
  } else if (providerId === "monnify") {
    if (!input.bvn || input.bvn.replace(/\D/g, "").length !== 11) {
      throw new Error("Valid 11-digit BVN is required for Monnify reserved accounts");
    }
    const ninDigits = input.nin?.replace(/\D/g, "") ?? "";
    const created = await createReservedAccount({
      userId: input.userId,
      userName: input.userName,
      email: input.email,
      bvn: input.bvn.replace(/\D/g, ""),
      ...(ninDigits.length === 11 ? { nin: ninDigits } : {}),
    });
    account = {
      accountReference: created.accountReference,
      accountName: created.accountName,
      accountNumber: created.accountNumber,
      bankName: created.bankName,
      bankCode: created.bankCode,
      reservationReference: created.reservationReference,
    };
  } else {
    const funding = getWalletFundingAdapter(providerId);
    const created = await funding.createVirtualAccount({
      userId: input.userId,
      userName: input.userName,
      email: input.email,
      bvn: input.bvn ?? "",
      nin: input.nin,
    });
    account = {
      accountReference: created.accountReference,
      accountName: created.accountName,
      accountNumber: created.accountNumber,
      bankName: created.bankName,
      bankCode: created.bankCode,
      reservationReference: created.reservationReference,
    };
  }

  const { error: insertErr } = await supabase.from("reserved_accounts").insert({
    user_id: input.userId,
    wallet_id: input.walletId,
    provider_id: providerId,
    account_reference: account.accountReference,
    account_name: account.accountName,
    account_number: account.accountNumber,
    bank_name: account.bankName,
    bank_code: account.bankCode,
    reservation_reference: account.reservationReference,
  });

  if (insertErr) throw insertErr;

  return { ...account, providerId };
}
