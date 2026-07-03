-- Migration 040: Configurable NGN withdrawal fees (platform % + flat transaction fee)
-- =============================================================================

ALTER TABLE public.platform_settings
  ADD COLUMN IF NOT EXISTS withdrawal_platform_fee_percent NUMERIC(5, 2) NOT NULL DEFAULT 0
    CHECK (withdrawal_platform_fee_percent >= 0 AND withdrawal_platform_fee_percent <= 100),
  ADD COLUMN IF NOT EXISTS withdrawal_transaction_fee_kobo BIGINT NOT NULL DEFAULT 5000
    CHECK (withdrawal_transaction_fee_kobo >= 0);

COMMENT ON COLUMN public.platform_settings.withdrawal_platform_fee_percent IS
  'Platform fee on NGN withdrawals as a percentage of withdrawal amount (e.g. 5 = 5%).';
COMMENT ON COLUMN public.platform_settings.withdrawal_transaction_fee_kobo IS
  'Flat transaction fee on NGN withdrawals in kobo (e.g. 5000 = ₦50).';

CREATE OR REPLACE FUNCTION public.get_withdrawal_fee_settings()
RETURNS jsonb
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path = public
AS $$
  SELECT jsonb_build_object(
    'platform_fee_percent', withdrawal_platform_fee_percent,
    'transaction_fee_kobo', withdrawal_transaction_fee_kobo,
    'transaction_fee_naira', withdrawal_transaction_fee_kobo::numeric / 100
  )
  FROM public.platform_settings
  WHERE id = 1;
$$;

CREATE OR REPLACE FUNCTION public.set_withdrawal_fee_settings(
  _platform_fee_percent numeric,
  _transaction_fee_kobo bigint
)
RETURNS void
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  _admin_id uuid := auth.uid();
BEGIN
  IF NOT public.has_admin_role(_admin_id, 'super_admin') THEN
    RAISE EXCEPTION 'Only super admins can update withdrawal fees';
  END IF;

  IF _platform_fee_percent < 0 OR _platform_fee_percent > 100 THEN
    RAISE EXCEPTION 'Platform fee percent must be between 0 and 100';
  END IF;

  IF _transaction_fee_kobo < 0 THEN
    RAISE EXCEPTION 'Transaction fee cannot be negative';
  END IF;

  UPDATE public.platform_settings
  SET withdrawal_platform_fee_percent = _platform_fee_percent,
      withdrawal_transaction_fee_kobo = _transaction_fee_kobo,
      updated_at = now(),
      updated_by = _admin_id
  WHERE id = 1;

  PERFORM public.log_admin_action(
    _admin_id,
    'set_withdrawal_fee_settings',
    'platform_settings',
    NULL,
    jsonb_build_object(
      'platform_fee_percent', _platform_fee_percent,
      'transaction_fee_kobo', _transaction_fee_kobo
    )
  );
END;
$$;

GRANT EXECUTE ON FUNCTION public.get_withdrawal_fee_settings() TO authenticated;
GRANT EXECUTE ON FUNCTION public.set_withdrawal_fee_settings(numeric, bigint) TO authenticated;
