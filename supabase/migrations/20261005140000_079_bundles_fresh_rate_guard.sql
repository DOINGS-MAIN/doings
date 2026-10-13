-- Bundles phase 2 follow-up: USDC deposits are never converted at a stale automatic FX rate.
-- The stored binance rate was 7 weeks old when phase 2 shipped; edge functions now refresh it
-- before converting, and this guard keeps the order pending (cron retries) if refresh failed.

CREATE OR REPLACE FUNCTION public.convert_usdc_deposit_to_bundles(
  p_user_id UUID,
  p_usdc_wallet_id UUID,
  p_amount_micro BIGINT,
  p_tx_hash TEXT
)
RETURNS JSONB
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_ref TEXT := 'usdc:' || p_tx_hash;
  v_order public.bundle_orders%ROWTYPE;
  v_s public.platform_settings%ROWTYPE;
  v_rate BIGINT;
  v_gross BIGINT;
  v_fee BIGINT;
  v_bundles BIGINT;
  v_credit BIGINT;
  v_t_ngn UUID := public.get_treasury_wallet_id('NGN');
  v_t_usdc UUID := public.get_treasury_wallet_id('USDC');
  v_treasury UUID := '00000000-0000-4000-8000-000000000001';
  v_t_avail BIGINT;
  v_user_ngn UUID;
  v_txn UUID;
  v_key TEXT := 'bundle-usdc-' || p_tx_hash;
BEGIN
  INSERT INTO public.bundle_orders (user_id, currency, amount, tx_ref, status, provider, provider_ref, wallet_id)
    VALUES (p_user_id, 'USDC', p_amount_micro, v_ref, 'pending_float', 'blockradar', p_tx_hash, p_usdc_wallet_id)
    ON CONFLICT (tx_ref) DO NOTHING;
  SELECT * INTO v_order FROM public.bundle_orders WHERE tx_ref = v_ref FOR UPDATE;
  IF v_order.status IN ('credited', 'below_minimum') THEN
    RETURN jsonb_build_object('order_id', v_order.id, 'status', v_order.status, 'already', true);
  END IF;

  SELECT * INTO v_s FROM public.platform_settings LIMIT 1;
  IF p_amount_micro < v_s.bundle_usdc_min_micro THEN
    UPDATE public.bundle_orders SET status = 'below_minimum', failure_reason = 'Below minimum USDC purchase',
      updated_at = now() WHERE id = v_order.id;
    RETURN jsonb_build_object('order_id', v_order.id, 'status', 'below_minimum');
  END IF;
  IF NOT v_s.bundle_usdc_enabled OR v_s.fx_market_rate_kobo IS NULL OR v_s.fx_market_rate_kobo <= 0 THEN
    UPDATE public.bundle_orders SET status = 'pending_float',
      failure_reason = CASE WHEN NOT v_s.bundle_usdc_enabled THEN 'USDC purchases paused' ELSE 'Rate unavailable' END,
      updated_at = now() WHERE id = v_order.id;
    RETURN jsonb_build_object('order_id', v_order.id, 'status', 'pending_float');
  END IF;

  -- Never convert at a stale automatic rate (manual rates are maintained by admins).
  IF v_s.fx_rate_source <> 'manual'
     AND (v_s.fx_market_rate_updated_at IS NULL OR v_s.fx_market_rate_updated_at < now() - interval '30 minutes') THEN
    UPDATE public.bundle_orders SET status = 'pending_float', failure_reason = 'Rate stale',
      updated_at = now() WHERE id = v_order.id;
    RETURN jsonb_build_object('order_id', v_order.id, 'status', 'pending_float');
  END IF;

  -- Same effective (sell) rate as USDC -> NGN conversions, then the bundle purchase fee.
  v_rate := public.fx_compute_sell_rate_kobo(v_s.fx_market_rate_kobo, v_s.fx_sell_flat_kobo, v_s.fx_sell_percent);
  v_gross := FLOOR(p_amount_micro::NUMERIC * v_rate / 1000000);
  v_fee := v_s.bundle_fee_flat_kobo + FLOOR(v_gross * v_s.bundle_fee_percent / 100);
  v_bundles := GREATEST(FLOOR((v_gross - v_fee)::NUMERIC / v_s.bundle_price_kobo), 0);
  v_credit := v_bundles * v_s.bundle_price_kobo;
  IF v_bundles <= 0 THEN
    UPDATE public.bundle_orders SET status = 'below_minimum', failure_reason = 'Deposit does not cover the fee',
      updated_at = now() WHERE id = v_order.id;
    RETURN jsonb_build_object('order_id', v_order.id, 'status', 'below_minimum');
  END IF;

  SELECT balance - locked_balance INTO v_t_avail FROM public.wallets WHERE id = v_t_ngn FOR UPDATE;
  IF COALESCE(v_t_avail, 0) < v_credit THEN
    UPDATE public.bundle_orders SET status = 'pending_float', bundles = v_bundles, fee_kobo = v_fee,
      failure_reason = 'Waiting for treasury NGN float', updated_at = now() WHERE id = v_order.id;
    RETURN jsonb_build_object('order_id', v_order.id, 'status', 'pending_float', 'bundles', v_bundles);
  END IF;

  SELECT id INTO v_user_ngn FROM public.wallets WHERE user_id = p_user_id AND currency = 'NGN';

  PERFORM public.debit_wallet(p_usdc_wallet_id, p_user_id, p_amount_micro, 0, 'purchase',
    'Bundles purchase · USDC in', 'internal', v_key || '-usdc-out',
    jsonb_build_object('bundle_order_id', v_order.id, 'tx_hash', p_tx_hash));
  PERFORM public.credit_wallet(v_t_usdc, v_treasury, p_amount_micro, 0, 'purchase',
    'Bundles purchase · treasury USDC in', 'internal', NULL, v_key || '-treasury-usdc-in',
    jsonb_build_object('bundle_order_id', v_order.id));
  PERFORM public.debit_wallet(v_t_ngn, v_treasury, v_credit, 0, 'purchase',
    'Bundles purchase · treasury NGN out', 'internal', v_key || '-treasury-ngn-out',
    jsonb_build_object('bundle_order_id', v_order.id));
  v_txn := public.credit_wallet(v_user_ngn, p_user_id, v_credit, 0, 'purchase',
    format('Bought %s bundles with USDC', v_bundles), 'blockradar', p_tx_hash, v_key || '-bundles-in',
    jsonb_build_object('bundle_order_id', v_order.id, 'bundles', v_bundles, 'usdc_micro', p_amount_micro,
      'rate_kobo', v_rate, 'fee_kobo', v_fee));

  UPDATE public.bundle_orders
    SET status = 'credited', bundles = v_bundles, fee_kobo = v_fee, credit_transaction_id = v_txn,
        failure_reason = NULL, updated_at = now()
    WHERE id = v_order.id;
  RETURN jsonb_build_object('order_id', v_order.id, 'status', 'credited', 'bundles', v_bundles);
END;
$$;
