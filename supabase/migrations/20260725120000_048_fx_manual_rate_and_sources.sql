-- Migration 048: FX manual rate + broader rate sources (Binance NGN P2P is dead)
-- =============================================================================

ALTER TABLE public.platform_settings
  DROP CONSTRAINT IF EXISTS platform_settings_fx_rate_source_check;

ALTER TABLE public.platform_settings
  ADD CONSTRAINT platform_settings_fx_rate_source_check
  CHECK (fx_rate_source IN ('binance', 'bybit', 'paycrest', 'manual'));

COMMENT ON COLUMN public.platform_settings.fx_rate_source IS
  'Market rate provider. binance = auto P2P (falls back to Bybit USDT/NGN); manual = admin-set.';

CREATE OR REPLACE FUNCTION public.set_fx_market_rate_manual(p_market_rate_naira numeric)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  _admin_id uuid := auth.uid();
  v_kobo BIGINT;
  v_result jsonb;
BEGIN
  IF NOT (
    public.has_admin_role(_admin_id, 'super_admin')
    OR public.has_admin_role(_admin_id, 'finance')
  ) THEN
    RAISE EXCEPTION 'Only finance or super admins can set FX market rate';
  END IF;

  IF p_market_rate_naira IS NULL OR p_market_rate_naira <= 0 THEN
    RAISE EXCEPTION 'Market rate must be a positive naira amount per USDC';
  END IF;

  v_kobo := ROUND(p_market_rate_naira * 100)::BIGINT;

  UPDATE public.platform_settings
  SET fx_rate_source = 'manual',
      updated_at = now(),
      updated_by = _admin_id
  WHERE id = 1;

  v_result := public.update_fx_market_rate(
    v_kobo,
    'manual',
    jsonb_build_object(
      'provider', 'manual',
      'market_rate_naira', p_market_rate_naira,
      'set_by', _admin_id
    )
  );

  PERFORM public.log_admin_action(
    _admin_id,
    'set_fx_market_rate_manual',
    'platform_settings',
    NULL,
    jsonb_build_object('market_rate_naira', p_market_rate_naira, 'market_rate_kobo', v_kobo)
  );

  RETURN v_result;
END;
$$;

CREATE OR REPLACE FUNCTION public.set_fx_settings(
  _enabled boolean,
  _rate_source text,
  _sell_flat_kobo bigint,
  _sell_percent numeric,
  _buy_flat_kobo bigint,
  _buy_percent numeric,
  _sell_platform_fee_percent numeric,
  _buy_platform_fee_percent numeric,
  _daily_cap_usdc_micro bigint,
  _min_trade_usdc_micro bigint,
  _quote_ttl_seconds int
)
RETURNS void
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  _admin_id uuid := auth.uid();
BEGIN
  IF NOT (
    public.has_admin_role(_admin_id, 'super_admin')
    OR public.has_admin_role(_admin_id, 'finance')
  ) THEN
    RAISE EXCEPTION 'Only finance or super admins can update FX settings';
  END IF;

  IF _rate_source NOT IN ('binance', 'bybit', 'paycrest', 'manual') THEN
    RAISE EXCEPTION 'Invalid rate source';
  END IF;

  UPDATE public.platform_settings
  SET fx_enabled = _enabled,
      fx_rate_source = _rate_source,
      fx_sell_flat_kobo = _sell_flat_kobo,
      fx_sell_percent = _sell_percent,
      fx_buy_flat_kobo = _buy_flat_kobo,
      fx_buy_percent = _buy_percent,
      fx_sell_platform_fee_percent = _sell_platform_fee_percent,
      fx_buy_platform_fee_percent = _buy_platform_fee_percent,
      fx_daily_cap_usdc_micro = _daily_cap_usdc_micro,
      fx_min_trade_usdc_micro = _min_trade_usdc_micro,
      fx_quote_ttl_seconds = _quote_ttl_seconds,
      updated_at = now(),
      updated_by = _admin_id
  WHERE id = 1;

  PERFORM public.log_admin_action(
    _admin_id,
    'set_fx_settings',
    'platform_settings',
    NULL,
    jsonb_build_object(
      'enabled', _enabled,
      'rate_source', _rate_source,
      'sell_flat_kobo', _sell_flat_kobo,
      'sell_percent', _sell_percent,
      'buy_flat_kobo', _buy_flat_kobo,
      'buy_percent', _buy_percent,
      'sell_platform_fee_percent', _sell_platform_fee_percent,
      'buy_platform_fee_percent', _buy_platform_fee_percent,
      'daily_cap_usdc_micro', _daily_cap_usdc_micro,
      'min_trade_usdc_micro', _min_trade_usdc_micro,
      'quote_ttl_seconds', _quote_ttl_seconds
    )
  );
END;
$$;

REVOKE ALL ON FUNCTION public.set_fx_market_rate_manual(numeric) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.set_fx_market_rate_manual(numeric) TO authenticated;
