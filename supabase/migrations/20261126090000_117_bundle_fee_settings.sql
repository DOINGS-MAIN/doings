-- 117: the admin sets the fees people actually pay.
-- Buying and selling bundles charge bundle_fee_* and bundle_sell_fee_* (a flat part plus a percentage
-- of the value; migrations 078, 083). No admin screen could change them: the admin's "NGN Withdrawal
-- Fees" card edits withdrawal_platform_fee_percent / withdrawal_transaction_fee_kobo, which belonged to
-- the wallet withdrawals retired in 107, so it showed 5% + N50 while every sale charged a flat N150
-- (go-live test C1, 2026-11-21). These two functions read and set the real fees. Nothing is changed
-- by this migration itself: the fees stay as they are until a super admin saves new ones.

CREATE OR REPLACE FUNCTION public.bundle_fee_settings_json()
RETURNS jsonb
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path = public
AS $$
  SELECT jsonb_build_object(
    'buy_fee_percent', bundle_fee_percent,
    'buy_fee_flat_kobo', bundle_fee_flat_kobo,
    'sell_fee_percent', bundle_sell_fee_percent,
    'sell_fee_flat_kobo', bundle_sell_fee_flat_kobo,
    'bundle_price_kobo', bundle_price_kobo,
    'bundle_min_purchase', bundle_min_purchase,
    'bundle_sell_min', bundle_sell_min)
  FROM public.platform_settings WHERE id = 1
$$;
REVOKE ALL ON FUNCTION public.bundle_fee_settings_json() FROM PUBLIC, anon, authenticated;

CREATE OR REPLACE FUNCTION public.get_bundle_fee_settings()
RETURNS jsonb
LANGUAGE plpgsql
STABLE
SECURITY DEFINER
SET search_path = public
AS $$
BEGIN
  IF auth.uid() IS NULL OR NOT public.has_admin_role(auth.uid(), 'super_admin') THEN
    RAISE EXCEPTION 'Only super admins can see the fee settings';
  END IF;
  RETURN public.bundle_fee_settings_json();
END;
$$;
REVOKE ALL ON FUNCTION public.get_bundle_fee_settings() FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.get_bundle_fee_settings() TO authenticated;

CREATE OR REPLACE FUNCTION public.set_bundle_fee_settings(
  _buy_fee_percent numeric,
  _buy_fee_flat_kobo bigint,
  _sell_fee_percent numeric,
  _sell_fee_flat_kobo bigint
)
RETURNS void
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  _admin_id uuid := auth.uid();
  _before jsonb;
  _min_sale_kobo bigint;
BEGIN
  IF _admin_id IS NULL OR NOT public.has_admin_role(_admin_id, 'super_admin') THEN
    RAISE EXCEPTION 'Only super admins can change fees';
  END IF;
  IF _buy_fee_percent IS NULL OR _buy_fee_flat_kobo IS NULL OR _sell_fee_percent IS NULL OR _sell_fee_flat_kobo IS NULL THEN
    RAISE EXCEPTION 'Every fee is required';
  END IF;
  IF _buy_fee_flat_kobo < 0 OR _sell_fee_flat_kobo < 0 OR _buy_fee_percent < 0 OR _sell_fee_percent < 0 THEN
    RAISE EXCEPTION 'A fee cannot be negative';
  END IF;
  -- The columns allow up to 50% (078, 083); say so in words instead of a constraint error.
  IF _buy_fee_percent > 50 OR _sell_fee_percent >= 50 THEN
    RAISE EXCEPTION 'A percentage fee must be below 50';
  END IF;

  PERFORM 1 FROM public.platform_settings WHERE id = 1 FOR UPDATE;
  _before := public.bundle_fee_settings_json();

  -- The smallest sale allowed must still pay something after the fee, or every sale of that size
  -- would be refused with "Sale does not cover the fee".
  SELECT bundle_sell_min * bundle_price_kobo INTO _min_sale_kobo FROM public.platform_settings WHERE id = 1;
  IF _sell_fee_flat_kobo + FLOOR(_min_sale_kobo * _sell_fee_percent / 100) >= _min_sale_kobo THEN
    RAISE EXCEPTION 'The sell fee would take all of the smallest sale. Lower the fee or raise the smallest sale.';
  END IF;

  UPDATE public.platform_settings
     SET bundle_fee_percent = _buy_fee_percent,
         bundle_fee_flat_kobo = _buy_fee_flat_kobo,
         bundle_sell_fee_percent = _sell_fee_percent,
         bundle_sell_fee_flat_kobo = _sell_fee_flat_kobo,
         updated_at = now(), updated_by = _admin_id
   WHERE id = 1;

  PERFORM public.log_admin_action(_admin_id, 'set_bundle_fee_settings', 'platform_settings', NULL,
    public.bundle_fee_settings_json() || jsonb_build_object('before', _before));
END;
$$;
REVOKE ALL ON FUNCTION public.set_bundle_fee_settings(numeric, bigint, numeric, bigint) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.set_bundle_fee_settings(numeric, bigint, numeric, bigint) TO authenticated;
