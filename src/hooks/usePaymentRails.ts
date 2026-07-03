import { useCallback, useEffect, useState } from "react";
import { admin as adminApi } from "@/lib/supabase";
import type { PlatformPaymentSettings, PspProvider } from "@/types/admin";
import type { WithdrawalFeeSettings } from "@/types/finance";
import { DEFAULT_WITHDRAWAL_FEE_SETTINGS } from "@/lib/withdrawalFees";

type RawProvider = {
  id: string;
  display_name: string;
  capabilities: string[];
  status: PspProvider["status"];
  config_schema?: Record<string, unknown>;
  updated_at?: string;
};

type RawSettings = {
  wallet_funding_provider_id: string;
  disbursement_provider_id: string;
  psp_env: PlatformPaymentSettings["pspEnv"];
};

function mapProvider(row: RawProvider): PspProvider {
  return {
    id: row.id,
    displayName: row.display_name,
    capabilities: row.capabilities as PspProvider["capabilities"],
    status: row.status,
    configSchema: row.config_schema ?? {},
    updatedAt: row.updated_at ? new Date(row.updated_at) : undefined,
  };
}

export type ProviderHealth = {
  ok: boolean;
  message: string;
  details?: Record<string, unknown>;
};

export const usePaymentRails = () => {
  const [providers, setProviders] = useState<PspProvider[]>([]);
  const [settings, setSettings] = useState<PlatformPaymentSettings | null>(null);
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [healthByProvider, setHealthByProvider] = useState<Record<string, ProviderHealth>>({});
  const [healthLoading, setHealthLoading] = useState<Record<string, boolean>>({});
  const [withdrawalFees, setWithdrawalFees] = useState<WithdrawalFeeSettings>(DEFAULT_WITHDRAWAL_FEE_SETTINGS);
  const [withdrawalFeesLoading, setWithdrawalFeesLoading] = useState(false);

  const refresh = useCallback(async () => {
    setLoading(true);
    try {
      const res = (await adminApi.paymentRails.get()) as {
        providers?: RawProvider[];
        settings?: RawSettings;
      };

      setProviders((res.providers ?? []).map(mapProvider));
      if (res.settings) {
        setSettings({
          walletFundingProviderId: res.settings.wallet_funding_provider_id,
          disbursementProviderId: res.settings.disbursement_provider_id,
          pspEnv: res.settings.psp_env,
        });
      }
    } finally {
      setLoading(false);
    }
  }, []);

  const fetchWithdrawalFees = useCallback(async () => {
    setWithdrawalFeesLoading(true);
    try {
      const { data, error } = await adminApi.paymentRails.getWithdrawalFees();
      if (error) throw error;
      if (data) {
        const row = data as {
          platform_fee_percent?: number;
          transaction_fee_naira?: number;
        };
        setWithdrawalFees({
          platformFeePercent: Number(row.platform_fee_percent ?? 0),
          transactionFeeNaira: Number(row.transaction_fee_naira ?? 50),
        });
      }
    } finally {
      setWithdrawalFeesLoading(false);
    }
  }, []);

  useEffect(() => {
    refresh();
  }, [refresh]);

  const setFundingProvider = useCallback(
    async (providerId: string) => {
      setSaving(true);
      try {
        const { error } = await adminApi.paymentRails.setFundingProvider(providerId);
        if (error) throw error;
        await refresh();
      } finally {
        setSaving(false);
      }
    },
    [refresh]
  );

  const setDisbursementProvider = useCallback(
    async (providerId: string) => {
      setSaving(true);
      try {
        const { error } = await adminApi.paymentRails.setDisbursementProvider(providerId);
        if (error) throw error;
        await refresh();
      } finally {
        setSaving(false);
      }
    },
    [refresh]
  );

  const setPspEnv = useCallback(
    async (pspEnv: PlatformPaymentSettings["pspEnv"]) => {
      setSaving(true);
      try {
        const { error } = await adminApi.paymentRails.setPspEnv(pspEnv);
        if (error) throw error;
        await refresh();
      } finally {
        setSaving(false);
      }
    },
    [refresh]
  );

  const probeHealth = useCallback(async (providerId: string) => {
    setHealthLoading((prev) => ({ ...prev, [providerId]: true }));
    try {
      const res = (await adminApi.paymentRails.health(providerId)) as ProviderHealth;
      setHealthByProvider((prev) => ({
        ...prev,
        [providerId]: { ok: Boolean(res.ok), message: res.message ?? "", details: res.details },
      }));
    } catch (err) {
      setHealthByProvider((prev) => ({
        ...prev,
        [providerId]: { ok: false, message: err instanceof Error ? err.message : "Health check failed" },
      }));
    } finally {
      setHealthLoading((prev) => ({ ...prev, [providerId]: false }));
    }
  }, []);

  const probeAll = useCallback(async () => {
    setSaving(true);
    try {
      const res = (await adminApi.paymentRails.probeAll()) as { results?: { provider_id: string; ok: boolean; message: string }[] };
      for (const row of res.results ?? []) {
        setHealthByProvider((prev) => ({
          ...prev,
          [row.provider_id]: { ok: row.ok, message: row.message },
        }));
      }
      await refresh();
    } finally {
      setSaving(false);
    }
  }, [refresh]);

  const setWithdrawalFeesSettings = useCallback(
    async (platformFeePercent: number, transactionFeeNaira: number) => {
      setSaving(true);
      try {
        const { error } = await adminApi.paymentRails.setWithdrawalFees(platformFeePercent, transactionFeeNaira);
        if (error) throw error;
        await fetchWithdrawalFees();
      } finally {
        setSaving(false);
      }
    },
    [fetchWithdrawalFees]
  );

  return {
    providers,
    settings,
    loading,
    saving,
    healthByProvider,
    healthLoading,
    withdrawalFees,
    withdrawalFeesLoading,
    refresh,
    setFundingProvider,
    setDisbursementProvider,
    setPspEnv,
    fetchWithdrawalFees,
    setWithdrawalFees: setWithdrawalFeesSettings,
    probeHealth,
    probeAll,
  };
};
