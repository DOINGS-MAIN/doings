-- Bundles phase 2 review fixes (USDC path):
--   1. A failed conversion no longer loses the order: everything after the order row runs in a
--      sub-block that parks the order as pending_float on any error (the cron retries it), and the
--      cron also sweeps confirmed Blockradar deposits since phase 2 that have no order at all.
--   2. While an order waits (pending_float) its USDC is held in locked_balance, so it can't be spent
--      and a later retry can't convert unrelated USDC. If the USDC is already gone, the order fails
--      instead of retrying forever. Retries rotate by updated_at so stuck rows can't block the queue.
--   3. Treasury USDC is locked before treasury NGN (same order as execute_fx_swap).

ALTER TABLE public.bundle_orders ADD COLUMN IF NOT EXISTS usdc_locked BOOLEAN NOT NULL DEFAULT false;

-- Park a USDC order as pending_float, holding its USDC. Fails the order if the USDC is gone.
CREATE OR REPLACE FUNCTION public.park_usdc_bundle_order(
  p_order_id UUID,
  p_reason TEXT,
  p_bundles BIGINT DEFAULT NULL,
  p_fee BIGINT DEFAULT NULL
)
RETURNS TEXT
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_order public.bundle_orders%ROWTYPE;
BEGIN
  SELECT * INTO v_order FROM public.bundle_orders WHERE id = p_order_id FOR UPDATE;
  IF NOT FOUND OR v_order.currency <> 'USDC' THEN
    RETURN NULL;
  END IF;

  IF NOT v_order.usdc_locked THEN
    UPDATE public.wallets
      SET locked_balance = locked_balance + v_order.amount, updated_at = now()
      WHERE id = v_order.wallet_id AND balance - locked_balance >= v_order.amount;
    IF NOT FOUND THEN
      UPDATE public.bundle_orders
        SET status = 'failed', failure_reason = 'USDC no longer available to convert', updated_at = now()
        WHERE id = p_order_id;
      RETURN 'failed';
    END IF;
  END IF;

  UPDATE public.bundle_orders
    SET status = 'pending_float', usdc_locked = true, failure_reason = p_reason,
        bundles = COALESCE(p_bundles, bundles), fee_kobo = COALESCE(p_fee, fee_kobo),
        updated_at = now()
    WHERE id = p_order_id;
  RETURN 'pending_float';
END;
$$;

-- Release a held deposit (order credited or reclassified as below minimum).
CREATE OR REPLACE FUNCTION public.unlock_usdc_bundle_order(p_order_id UUID)
RETURNS VOID
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_order public.bundle_orders%ROWTYPE;
BEGIN
  SELECT * INTO v_order FROM public.bundle_orders WHERE id = p_order_id FOR UPDATE;
  IF NOT FOUND OR NOT v_order.usdc_locked THEN
    RETURN;
  END IF;
  UPDATE public.wallets
    SET locked_balance = GREATEST(0, locked_balance - v_order.amount), updated_at = now()
    WHERE id = v_order.wallet_id;
  UPDATE public.bundle_orders SET usdc_locked = false, updated_at = now() WHERE id = p_order_id;
END;
$$;

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
  v_status TEXT;
BEGIN
  INSERT INTO public.bundle_orders (user_id, currency, amount, tx_ref, status, provider, provider_ref, wallet_id)
    VALUES (p_user_id, 'USDC', p_amount_micro, v_ref, 'pending_float', 'blockradar', p_tx_hash, p_usdc_wallet_id)
    ON CONFLICT (tx_ref) DO NOTHING;
  SELECT * INTO v_order FROM public.bundle_orders WHERE tx_ref = v_ref FOR UPDATE;
  IF v_order.status IN ('credited', 'below_minimum', 'failed') THEN
    RETURN jsonb_build_object('order_id', v_order.id, 'status', v_order.status, 'already', true);
  END IF;

  -- Everything below can fail (missing wallet, lock conflict, timeout); the order row survives and
  -- is parked for the cron instead of rolling back with the error.
  BEGIN
    SELECT * INTO v_s FROM public.platform_settings LIMIT 1;
    IF p_amount_micro < v_s.bundle_usdc_min_micro THEN
      PERFORM public.unlock_usdc_bundle_order(v_order.id);
      UPDATE public.bundle_orders SET status = 'below_minimum', failure_reason = 'Below minimum USDC purchase',
        updated_at = now() WHERE id = v_order.id;
      RETURN jsonb_build_object('order_id', v_order.id, 'status', 'below_minimum');
    END IF;
    IF NOT v_s.bundle_usdc_enabled OR v_s.fx_market_rate_kobo IS NULL OR v_s.fx_market_rate_kobo <= 0 THEN
      v_status := public.park_usdc_bundle_order(v_order.id,
        CASE WHEN NOT v_s.bundle_usdc_enabled THEN 'USDC purchases paused' ELSE 'Rate unavailable' END);
      RETURN jsonb_build_object('order_id', v_order.id, 'status', v_status);
    END IF;

    -- Never convert at a stale automatic rate (manual rates are maintained by admins).
    IF v_s.fx_rate_source <> 'manual'
       AND (v_s.fx_market_rate_updated_at IS NULL OR v_s.fx_market_rate_updated_at < now() - interval '30 minutes') THEN
      v_status := public.park_usdc_bundle_order(v_order.id, 'Rate stale');
      RETURN jsonb_build_object('order_id', v_order.id, 'status', v_status);
    END IF;

    -- Same effective (sell) rate as USDC -> NGN conversions, then the bundle purchase fee.
    v_rate := public.fx_compute_sell_rate_kobo(v_s.fx_market_rate_kobo, v_s.fx_sell_flat_kobo, v_s.fx_sell_percent);
    v_gross := FLOOR(p_amount_micro::NUMERIC * v_rate / 1000000);
    v_fee := v_s.bundle_fee_flat_kobo + FLOOR(v_gross * v_s.bundle_fee_percent / 100);
    v_bundles := GREATEST(FLOOR((v_gross - v_fee)::NUMERIC / v_s.bundle_price_kobo), 0);
    v_credit := v_bundles * v_s.bundle_price_kobo;
    IF v_bundles <= 0 THEN
      PERFORM public.unlock_usdc_bundle_order(v_order.id);
      UPDATE public.bundle_orders SET status = 'below_minimum', failure_reason = 'Deposit does not cover the fee',
        updated_at = now() WHERE id = v_order.id;
      RETURN jsonb_build_object('order_id', v_order.id, 'status', 'below_minimum');
    END IF;

    -- Treasury USDC before treasury NGN, matching execute_fx_swap's lock order.
    PERFORM 1 FROM public.wallets WHERE id = v_t_usdc FOR UPDATE;
    SELECT balance - locked_balance INTO v_t_avail FROM public.wallets WHERE id = v_t_ngn FOR UPDATE;
    IF COALESCE(v_t_avail, 0) < v_credit THEN
      v_status := public.park_usdc_bundle_order(v_order.id, 'Waiting for treasury NGN float', v_bundles, v_fee);
      RETURN jsonb_build_object('order_id', v_order.id, 'status', v_status, 'bundles', v_bundles);
    END IF;

    SELECT id INTO v_user_ngn FROM public.wallets WHERE user_id = p_user_id AND currency = 'NGN';
    IF v_user_ngn IS NULL THEN
      RAISE EXCEPTION 'NGN wallet not found for user %', p_user_id;
    END IF;

    PERFORM public.unlock_usdc_bundle_order(v_order.id);
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
  EXCEPTION WHEN OTHERS THEN
    v_status := public.park_usdc_bundle_order(v_order.id, left('Conversion error: ' || SQLERRM, 300));
    RETURN jsonb_build_object('order_id', v_order.id, 'status', v_status, 'error', SQLERRM);
  END;
END;
$$;

CREATE OR REPLACE FUNCTION public.retry_pending_bundle_orders()
RETURNS INT
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  r RECORD;
  n INT := 0;
BEGIN
  -- Confirmed Blockradar USDC deposits since phase 2 whose conversion never recorded an order.
  FOR r IN
    SELECT t.user_id, t.wallet_id, t.amount, t.provider_ref
    FROM public.transactions t
    WHERE t.provider = 'blockradar' AND t.type = 'deposit' AND t.currency = 'USDC'
      AND t.status = 'completed' AND t.provider_ref IS NOT NULL
      AND t.created_at >= '2026-10-05T00:00:00Z'
      AND NOT EXISTS (SELECT 1 FROM public.bundle_orders o WHERE o.tx_ref = 'usdc:' || t.provider_ref)
    ORDER BY t.created_at
    LIMIT 50
  LOOP
    BEGIN
      IF (public.convert_usdc_deposit_to_bundles(r.user_id, r.wallet_id, r.amount, r.provider_ref)->>'status') = 'credited' THEN
        n := n + 1;
      END IF;
    EXCEPTION WHEN OTHERS THEN
      NULL;
    END;
  END LOOP;

  -- Waiting orders, least recently tried first so a stuck row can't starve the rest.
  FOR r IN
    SELECT o.user_id, o.wallet_id, o.amount, o.provider_ref
    FROM public.bundle_orders o
    WHERE o.status = 'pending_float' AND o.currency = 'USDC'
    ORDER BY o.updated_at
    LIMIT 50
  LOOP
    BEGIN
      IF (public.convert_usdc_deposit_to_bundles(r.user_id, r.wallet_id, r.amount, r.provider_ref)->>'status') = 'credited' THEN
        n := n + 1;
      END IF;
    EXCEPTION WHEN OTHERS THEN
      NULL;
    END;
  END LOOP;
  RETURN n;
END;
$$;

REVOKE ALL ON FUNCTION public.park_usdc_bundle_order(UUID, TEXT, BIGINT, BIGINT) FROM PUBLIC, anon, authenticated;
REVOKE ALL ON FUNCTION public.unlock_usdc_bundle_order(UUID) FROM PUBLIC, anon, authenticated;
REVOKE ALL ON FUNCTION public.convert_usdc_deposit_to_bundles(UUID, UUID, BIGINT, TEXT) FROM PUBLIC, anon, authenticated;
REVOKE ALL ON FUNCTION public.retry_pending_bundle_orders() FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.park_usdc_bundle_order(UUID, TEXT, BIGINT, BIGINT) TO service_role;
GRANT EXECUTE ON FUNCTION public.unlock_usdc_bundle_order(UUID) TO service_role;
GRANT EXECUTE ON FUNCTION public.convert_usdc_deposit_to_bundles(UUID, UUID, BIGINT, TEXT) TO service_role;
GRANT EXECUTE ON FUNCTION public.retry_pending_bundle_orders() TO service_role;

-- Hold the USDC of orders already waiting (the legacy 20 USDC conversion).
DO $$
DECLARE r RECORD;
BEGIN
  FOR r IN SELECT id, failure_reason FROM public.bundle_orders
           WHERE status = 'pending_float' AND currency = 'USDC' AND NOT usdc_locked LOOP
    PERFORM public.park_usdc_bundle_order(r.id, r.failure_reason);
  END LOOP;
END $$;
