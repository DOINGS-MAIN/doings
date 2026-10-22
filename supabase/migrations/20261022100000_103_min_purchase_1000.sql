-- Smallest bundle purchase: 10,000 -> 1,000 bundles (2026-10-22). Data only; no function changes.
-- bundle_min_purchase is read by the `bundles` edge function on every quote and checkout, so it takes effect
-- immediately. The USDC deposit floor (bundle_usdc_min_micro = 5 USDC) is unchanged: the app now warns when a
-- small USDC purchase falls under it.
-- Next free migration number: check supabase/migrations (last 102).
ALTER TABLE public.platform_settings ALTER COLUMN bundle_min_purchase SET DEFAULT 1000;
UPDATE public.platform_settings SET bundle_min_purchase = 1000 WHERE bundle_min_purchase = 10000;
