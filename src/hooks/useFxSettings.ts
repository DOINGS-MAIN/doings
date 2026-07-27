import { useCallback, useEffect, useState } from "react";
import { admin as adminApi } from "@/lib/supabase";
import type { FxAdminSettings, TreasuryBalances } from "@/types/finance";

export function useFxSettings() {
  const [settings, setSettings] = useState<FxAdminSettings | null>(null);
  const [treasury, setTreasury] = useState<TreasuryBalances | null>(null);
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [refreshingRate, setRefreshingRate] = useState(false);

  const refresh = useCallback(async () => {
    setLoading(true);
    try {
      const [settingsRes, treasuryRes] = await Promise.all([
        adminApi.fx.getSettings(),
        adminApi.fx.getTreasuryBalances(),
      ]);
      if (settingsRes.data) setSettings(settingsRes.data as FxAdminSettings);
      if (treasuryRes.data) setTreasury(treasuryRes.data as TreasuryBalances);
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    void refresh();
  }, [refresh]);

  const saveSettings = useCallback(
    async (payload: {
      enabled: boolean;
      rateSource: "binance" | "bybit" | "paycrest" | "manual";
      sellFlatNaira: number;
      sellPercent: number;
      buyFlatNaira: number;
      buyPercent: number;
      sellPlatformFeePercent: number;
      buyPlatformFeePercent: number;
      dailyCapUsdc: number;
      minTradeUsdc: number;
      quoteTtlSeconds: number;
    }) => {
      setSaving(true);
      try {
        const { error } = await adminApi.fx.setSettings(payload);
        if (error) throw error;
        await refresh();
      } finally {
        setSaving(false);
      }
    },
    [refresh]
  );

  const refreshMarketRate = useCallback(async () => {
    setRefreshingRate(true);
    try {
      await adminApi.fx.refreshRate();
      await refresh();
    } finally {
      setRefreshingRate(false);
    }
  }, [refresh]);

  const setManualMarketRate = useCallback(async (marketRateNaira: number) => {
    setRefreshingRate(true);
    try {
      const { error } = await adminApi.fx.setManualRate(marketRateNaira);
      if (error) throw error;
      await refresh();
    } finally {
      setRefreshingRate(false);
    }
  }, [refresh]);

  const recordTopup = useCallback(
    async (currency: "NGN" | "USDC", amount: number, reference?: string, note?: string) => {
      setSaving(true);
      try {
        const { error } = await adminApi.fx.recordTopup(currency, amount, reference, note);
        if (error) throw error;
        await refresh();
      } finally {
        setSaving(false);
      }
    },
    [refresh]
  );

  return {
    settings,
    treasury,
    loading,
    saving,
    refreshingRate,
    refresh,
    saveSettings,
    refreshMarketRate,
    setManualMarketRate,
    recordTopup,
  };
}
