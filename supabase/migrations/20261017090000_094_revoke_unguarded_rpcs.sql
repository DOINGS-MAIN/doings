-- Unguarded SECURITY DEFINER writers (found 2026-10-16): with only the public anon key, anyone could
-- set the platform FX market rate (which prices USDC buys and sells), list every wallet balance,
-- or release other people's spray holds. Their only legitimate callers are edge functions using
-- service_role (fx-rates, fx-quote, _shared/bundles, cron-reconciliation, spray).

REVOKE ALL ON FUNCTION public.update_fx_market_rate(bigint, text, jsonb) FROM PUBLIC, anon, authenticated;
REVOKE ALL ON FUNCTION public.reconcile_wallets() FROM PUBLIC, anon, authenticated;
REVOKE ALL ON FUNCTION public.cleanup_spray_holds() FROM PUBLIC, anon, authenticated;
REVOKE ALL ON FUNCTION public.release_expired_spray_holds() FROM PUBLIC, anon, authenticated;
REVOKE ALL ON FUNCTION public.release_stale_spray_holds() FROM PUBLIC, anon, authenticated;

GRANT EXECUTE ON FUNCTION public.update_fx_market_rate(bigint, text, jsonb) TO service_role;
GRANT EXECUTE ON FUNCTION public.reconcile_wallets() TO service_role;
GRANT EXECUTE ON FUNCTION public.cleanup_spray_holds() TO service_role;
GRANT EXECUTE ON FUNCTION public.release_expired_spray_holds() TO service_role;
GRANT EXECUTE ON FUNCTION public.release_stale_spray_holds() TO service_role;
