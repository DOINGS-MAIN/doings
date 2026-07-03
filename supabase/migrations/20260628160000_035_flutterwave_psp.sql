-- Migration 035: Register Flutterwave as a PSP provider
-- =====================================================

INSERT INTO public.psp_providers (id, display_name, capabilities, status, config_schema) VALUES
  (
    'flutterwave',
    'Flutterwave',
    ARRAY['wallet_funding', 'disbursement', 'bank_verify'],
    'active',
    '{"secrets":["FLUTTERWAVE_SECRET_KEY","FLUTTERWAVE_WEBHOOK_SECRET_HASH","FLUTTERWAVE_PUBLIC_KEY","FLUTTERWAVE_DEFAULT_PHONE"]}'::jsonb
  )
ON CONFLICT (id) DO NOTHING;
