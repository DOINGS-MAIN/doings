import { useCallback, useEffect, useState } from "react";
import { admin as adminApi } from "@/lib/supabase";
import {
  DEFAULT_SPRAY_THEATRE_SETTINGS,
  parseSprayTheatreSettings,
  type SprayTheatreSettings,
} from "@/lib/sprayTheatrePlan";

export function useSprayTheatreSettings() {
  const [settings, setSettings] = useState<SprayTheatreSettings | null>(null);
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);

  const refresh = useCallback(async () => {
    setLoading(true);
    try {
      const { data, error } = await adminApi.sprayTheatre.getSettings();
      if (error) throw error;
      setSettings(parseSprayTheatreSettings(data));
    } catch {
      setSettings({ ...DEFAULT_SPRAY_THEATRE_SETTINGS });
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    void refresh();
  }, [refresh]);

  const saveSettings = useCallback(
    async (payload: SprayTheatreSettings) => {
      setSaving(true);
      try {
        const { error } = await adminApi.sprayTheatre.setSettings({
          stageMinPer100kDenom200: payload.stage_min_per_100k_denom_200,
          stageMinPer100kDenom500: payload.stage_min_per_100k_denom_500,
          stageMinPer100kDenom1000: payload.stage_min_per_100k_denom_1000,
          stageMinPer100Usdc: payload.stage_min_per_100_usdc,
          maxSingleSprayNgn: payload.max_single_spray_ngn,
          guestSessionCapSec: payload.guest_session_cap_sec,
          maxStageSec: payload.max_stage_sec,
          queueCompressionTiers: payload.queue_compression_tiers,
        });
        if (error) throw error;
        await refresh();
      } finally {
        setSaving(false);
      }
    },
    [refresh],
  );

  return { settings, loading, saving, refresh, saveSettings };
}
