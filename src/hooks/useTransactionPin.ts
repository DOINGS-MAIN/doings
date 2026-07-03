import { useCallback, useEffect, useState } from "react";
import { supabase, transactionPin } from "@/lib/supabase";

export const useTransactionPin = () => {
  const [hasPin, setHasPin] = useState<boolean | null>(null);
  const [loading, setLoading] = useState(true);

  const refresh = useCallback(async () => {
    setLoading(true);
    try {
      const { data, error } = await transactionPin.has();
      if (error) throw error;
      setHasPin(Boolean(data));
    } catch {
      setHasPin(false);
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    void refresh();
  }, [refresh]);

  const setPin = useCallback(
    async (pin: string, currentPin?: string) => {
      const { error: profileError } = await supabase.rpc("ensure_auth_user_profile");
      if (profileError) throw profileError;

      const { error } = await transactionPin.set(pin, currentPin);
      if (error) throw error;
      await refresh();
    },
    [refresh]
  );

  return { hasPin, loading, refresh, setPin };
};
