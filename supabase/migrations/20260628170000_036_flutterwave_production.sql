-- Migration 036: Flutterwave production go-live defaults
-- =====================================================
-- Safe to run after 035. Promotes Flutterwave to active and routes NGN rails through it.

UPDATE public.psp_providers
SET status = 'active', updated_at = now()
WHERE id = 'flutterwave';

UPDATE public.platform_settings
SET
  psp_env = 'production',
  wallet_funding_provider_id = 'flutterwave',
  disbursement_provider_id = 'flutterwave',
  updated_at = now()
WHERE id = 1;
