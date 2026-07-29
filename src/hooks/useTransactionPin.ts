import { useCallback, useEffect, useState } from "react";
import { supabase, transactionPin } from "@/lib/supabase";

/** Pass Supabase auth user id once session is ready; skips check until then. */
export const useTransactionPin = (authUserId: string | undefined) => {
  const [hasPin, setHasPin] = useState<boolean | null>(null);
  const [loading, setLoading] = useState(false);

  const refresh = useCallback(async () => {
    if (!authUserId) {
      setHasPin(null);
      setLoading(false);
      return;
    }
    setLoading(true);
    try {
      const { data, error } = await transactionPin.has();
      if (error) throw error;
      setHasPin(Boolean(data));
    } catch {
      // Transient auth/RPC failures must not read as "no PIN" (avoids false modal on login).
      setHasPin(null);
    } finally {
      setLoading(false);
    }
  }, [authUserId]);

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
