import type { SupabaseClient } from "https://esm.sh/@supabase/supabase-js@2.49.8";
import type { PspEnv } from "./types.ts";

export type PlatformPaymentSettings = {
  walletFundingProviderId: string;
  disbursementProviderId: string;
  pspEnv: PspEnv;
};

export async function getPlatformPaymentSettings(
  supabase: SupabaseClient,
): Promise<PlatformPaymentSettings> {
  const { data, error } = await supabase
    .from("platform_settings")
    .select("wallet_funding_provider_id, disbursement_provider_id, psp_env")
    .eq("id", 1)
    .single();

  if (error || !data) {
    throw new Error("platform_settings not configured");
  }

  return {
    walletFundingProviderId: data.wallet_funding_provider_id as string,
    disbursementProviderId: data.disbursement_provider_id as string,
    pspEnv: (data.psp_env as PspEnv) ?? "sandbox",
  };
}
