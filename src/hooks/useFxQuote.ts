import { useCallback, useEffect, useRef, useState } from "react";
import { fx as fxApi } from "@/lib/supabase";
import type { FxQuote, FxPublicSettings } from "@/types/finance";

export function useFxQuote() {
  const [settings, setSettings] = useState<FxPublicSettings | null>(null);
  const [quote, setQuote] = useState<FxQuote | null>(null);
  const [secondsLeft, setSecondsLeft] = useState(0);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const refreshTimer = useRef<ReturnType<typeof setInterval> | null>(null);
  const pendingSide = useRef<"sell" | "buy" | null>(null);
  const pendingAmount = useRef<number>(0);
  const refreshingRef = useRef(false);

  const clearTimer = useCallback(() => {
    if (refreshTimer.current) {
      clearInterval(refreshTimer.current);
      refreshTimer.current = null;
    }
  }, []);

  const startCountdown = useCallback((expiresAt: string, ttl: number) => {
    clearTimer();
    const update = () => {
      const left = Math.max(0, Math.ceil((new Date(expiresAt).getTime() - Date.now()) / 1000));
      setSecondsLeft(left);
      if (left <= 0) {
        clearTimer();
      }
    };
    update();
    setSecondsLeft(ttl);
    refreshTimer.current = setInterval(update, 1000);
  }, [clearTimer]);

  const fetchSettings = useCallback(async () => {
    const res = (await fxApi.getSettings()) as { settings?: FxPublicSettings };
    if (res.settings) setSettings(res.settings);
    return res.settings ?? null;
  }, []);

  const requestQuote = useCallback(async (side: "sell" | "buy", usdcAmount: number) => {
    pendingSide.current = side;
    pendingAmount.current = usdcAmount;
    setLoading(true);
    setError(null);
    try {
      const res = (await fxApi.createQuote(side, usdcAmount)) as { quote?: FxQuote };
      if (!res.quote) throw new Error("No quote returned");
      setQuote(res.quote);
      startCountdown(res.quote.expires_at, res.quote.ttl_seconds);
      return res.quote;
    } catch (err) {
      const msg = err instanceof Error ? err.message : "Failed to get quote";
      setError(msg);
      setQuote(null);
      throw err;
    } finally {
      setLoading(false);
    }
  }, [startCountdown]);

  // Auto-refresh when countdown expires
  useEffect(() => {
    if (secondsLeft !== 0 || !quote || !pendingSide.current || pendingAmount.current <= 0) return;
    if (refreshingRef.current) return;
    refreshingRef.current = true;
    void requestQuote(pendingSide.current, pendingAmount.current).finally(() => {
      refreshingRef.current = false;
    });
  }, [secondsLeft, quote, requestQuote]);

  useEffect(() => () => clearTimer(), [clearTimer]);

  const reset = useCallback(() => {
    clearTimer();
    setQuote(null);
    setSecondsLeft(0);
    setError(null);
    pendingSide.current = null;
    pendingAmount.current = 0;
  }, [clearTimer]);

  return {
    settings,
    quote,
    secondsLeft,
    loading,
    error,
    fetchSettings,
    requestQuote,
    reset,
  };
}
