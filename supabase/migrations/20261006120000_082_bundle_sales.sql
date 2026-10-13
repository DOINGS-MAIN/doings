-- Bundles phase 3: selling bundles.
-- A sale is an ordinary withdrawal on the user's NGN wallet (lock_withdrawal), finalised by
-- complete_bundle_sale / fail_bundle_sale. NGN sales pay out bundles x price - fee to the user's
-- name-matched bank account. USDC sales hold the bundles (NGN lock) and a treasury USDC reserve
-- until Blockradar confirms; on success the treasury legs are booked, on failure everything is
-- released, so a failed payout always returns the bundles. The USDC amount is fixed at sale time.

ALTER TABLE public.platform_settings
  ADD COLUMN IF NOT EXISTS bundle_sell_fee_flat_kobo BIGINT NOT NULL DEFAULT 15000
    CHECK (bundle_sell_fee_flat_kobo >= 0),
  ADD COLUMN IF NOT EXISTS bundle_sell_fee_percent NUMERIC(5,2) NOT NULL DEFAULT 0
    CHECK (bundle_sell_fee_percent >= 0 AND bundle_sell_fee_percent < 50),
  ADD COLUMN IF NOT EXISTS bundle_sell_min BIGINT NOT NULL DEFAULT 1000 CHECK (bundle_sell_min > 0),
  ADD COLUMN IF NOT EXISTS bundle_sell_usdc_enabled BOOLEAN NOT NULL DEFAULT true,
  ADD COLUMN IF NOT EXISTS bundle_sell_usdc_min_micro BIGINT NOT NULL DEFAULT 2000000
    CHECK (bundle_sell_usdc_min_micro > 0),
  ADD COLUMN IF NOT EXISTS bundle_sell_usdc_network_fee_micro BIGINT NOT NULL DEFAULT 1000000
    CHECK (bundle_sell_usdc_network_fee_micro >= 0);

-- NGN leaving the user's wallet today (UTC) through withdrawals of any kind, in flight included.
CREATE OR REPLACE FUNCTION public.bundle_sale_daily_used_kobo(p_user_id UUID)
RETURNS BIGINT
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path = public
AS $$
  SELECT COALESCE(SUM(ABS(t.net_amount)), 0)::BIGINT
  FROM public.transactions t
  WHERE t.user_id = p_user_id AND t.currency = 'NGN' AND t.type = 'withdrawal'
    AND t.status IN ('pending', 'processing', 'completed')
    AND t.created_at >= (date_trunc('day', now() AT TIME ZONE 'UTC') AT TIME ZONE 'UTC');
$$;

CREATE OR REPLACE FUNCTION public.create_bundle_sale(
  p_user_id UUID,
  p_bundles BIGINT,
  p_currency TEXT,
  p_destination JSONB,
  p_idempotency_key TEXT
)
RETURNS JSONB
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_s public.platform_settings%ROWTYPE;
  v_existing public.transactions%ROWTYPE;
  v_kyc SMALLINT;
  v_ngn UUID;
  v_value BIGINT;
  v_fee BIGINT;
  v_rate BIGINT;
  v_usdc BIGINT;
  v_net_fee BIGINT;
  v_t_usdc UUID := public.get_treasury_wallet_id('USDC');
  v_t_avail BIGINT;
  v_txn UUID;
BEGIN
  IF p_idempotency_key IS NULL OR length(p_idempotency_key) < 8 THEN
    RAISE EXCEPTION 'Missing idempotency key';
  END IF;
  PERFORM pg_advisory_xact_lock(hashtext('bundle-sale:' || p_user_id::text));

  SELECT * INTO v_existing FROM public.transactions
    WHERE idempotency_key = p_idempotency_key AND user_id = p_user_id;
  IF FOUND THEN
    RETURN jsonb_build_object('transaction_id', v_existing.id, 'reference', p_idempotency_key,
      'status', v_existing.status, 'already', true,
      'currency', CASE WHEN v_existing.metadata->>'kind' = 'bundle_sale_usdc' THEN 'USDC' ELSE 'NGN' END,
      'bundles', (v_existing.metadata->>'bundles')::BIGINT, 'fee_kobo', v_existing.fee,
      'payout_kobo', ABS(v_existing.amount), 'usdc_micro', (v_existing.metadata->>'usdc_micro')::BIGINT);
  END IF;

  SELECT kyc_level INTO v_kyc FROM public.users WHERE id = p_user_id;
  IF COALESCE(v_kyc, 0) < 2 THEN
    RAISE EXCEPTION 'Complete identity verification (BVN + NIN) to sell bundles';
  END IF;
  IF p_currency NOT IN ('NGN', 'USDC') THEN
    RAISE EXCEPTION 'currency must be NGN or USDC';
  END IF;

  SELECT * INTO v_s FROM public.platform_settings LIMIT 1;
  IF p_bundles IS NULL OR p_bundles < v_s.bundle_sell_min THEN
    RAISE EXCEPTION '%', format('Minimum sale is %s bundles', to_char(v_s.bundle_sell_min, 'FM999,999,999,999'));
  END IF;

  v_value := p_bundles * v_s.bundle_price_kobo;
  v_fee := v_s.bundle_sell_fee_flat_kobo + FLOOR(v_value * v_s.bundle_sell_fee_percent / 100);
  IF v_value <= v_fee THEN
    RAISE EXCEPTION 'Sale does not cover the fee';
  END IF;

  IF public.bundle_sale_daily_used_kobo(p_user_id) + v_value > 200000000 THEN
    RAISE EXCEPTION 'Daily limit reached for selling bundles';
  END IF;

  SELECT id INTO v_ngn FROM public.wallets WHERE user_id = p_user_id AND currency = 'NGN';
  IF v_ngn IS NULL THEN
    RAISE EXCEPTION 'NGN wallet not found';
  END IF;

  IF p_currency = 'NGN' THEN
    IF NOT (p_destination ? 'account_number') THEN
      RAISE EXCEPTION 'Bank account required';
    END IF;
    v_txn := public.lock_withdrawal(v_ngn, p_user_id, v_value - v_fee, v_fee, 'withdrawal',
      format('Sold %s bundles', p_bundles), v_s.disbursement_provider_id, NULL, p_idempotency_key,
      jsonb_build_object('kind', 'bundle_sale', 'bundles', p_bundles, 'payout_currency', 'NGN',
        'bank', p_destination, 'reference', p_idempotency_key));
    RETURN jsonb_build_object('transaction_id', v_txn, 'reference', p_idempotency_key, 'status', 'pending',
      'currency', 'NGN', 'bundles', p_bundles, 'fee_kobo', v_fee, 'payout_kobo', v_value - v_fee);
  END IF;

  -- USDC
  IF NOT v_s.bundle_sell_usdc_enabled THEN
    RAISE EXCEPTION 'USDC payouts are paused';
  END IF;
  IF NOT (p_destination ? 'address') THEN
    RAISE EXCEPTION 'Enter a valid Solana USDC address';
  END IF;
  IF v_s.fx_market_rate_kobo IS NULL OR v_s.fx_market_rate_kobo <= 0
     OR (v_s.fx_rate_source <> 'manual'
         AND (v_s.fx_market_rate_updated_at IS NULL OR v_s.fx_market_rate_updated_at < now() - interval '30 minutes')) THEN
    RAISE EXCEPTION 'Rate stale. Try again shortly.';
  END IF;

  v_rate := public.fx_compute_buy_rate_kobo(v_s.fx_market_rate_kobo, v_s.fx_buy_flat_kobo, v_s.fx_buy_percent);
  v_net_fee := v_s.bundle_sell_usdc_network_fee_micro;
  v_usdc := FLOOR((v_value - v_fee)::NUMERIC * 1000000 / v_rate) - v_net_fee;
  IF v_usdc < v_s.bundle_sell_usdc_min_micro THEN
    RAISE EXCEPTION '%', format('You need to sell more to receive at least %s USDC',
      trim_scale(v_s.bundle_sell_usdc_min_micro / 1000000.0));
  END IF;

  SELECT balance - locked_balance INTO v_t_avail FROM public.wallets WHERE id = v_t_usdc FOR UPDATE;
  IF COALESCE(v_t_avail, 0) < v_usdc + v_net_fee THEN
    RAISE EXCEPTION 'USDC payouts are temporarily unavailable';
  END IF;
  UPDATE public.wallets SET locked_balance = locked_balance + v_usdc + v_net_fee, updated_at = now()
    WHERE id = v_t_usdc;

  v_txn := public.lock_withdrawal(v_ngn, p_user_id, v_value - v_fee, v_fee, 'withdrawal',
    format('Sold %s bundles for USDC', p_bundles), 'blockradar', NULL, p_idempotency_key,
    jsonb_build_object('kind', 'bundle_sale_usdc', 'bundles', p_bundles, 'payout_currency', 'USDC',
      'usdc_micro', v_usdc, 'network_fee_micro', v_net_fee, 'rate_kobo', v_rate,
      'address', p_destination->>'address', 'reference', p_idempotency_key));
  RETURN jsonb_build_object('transaction_id', v_txn, 'reference', p_idempotency_key, 'status', 'pending',
    'currency', 'USDC', 'bundles', p_bundles, 'fee_kobo', v_fee, 'usdc_micro', v_usdc,
    'network_fee_micro', v_net_fee, 'rate_kobo', v_rate);
END;
$$;

CREATE OR REPLACE FUNCTION public.complete_bundle_sale(p_transaction_id UUID)
RETURNS VOID
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_txn public.transactions%ROWTYPE;
  v_n BIGINT;
  v_t_usdc UUID := public.get_treasury_wallet_id('USDC');
  v_treasury UUID := '00000000-0000-4000-8000-000000000001';
BEGIN
  SELECT * INTO v_txn FROM public.transactions WHERE id = p_transaction_id FOR UPDATE;
  IF NOT FOUND THEN
    RAISE EXCEPTION 'Transaction not found: %', p_transaction_id;
  END IF;
  IF v_txn.status NOT IN ('pending', 'processing') THEN
    RETURN;
  END IF;

  PERFORM public.complete_withdrawal(p_transaction_id);

  IF v_txn.metadata->>'kind' = 'bundle_sale_usdc' THEN
    -- The USDC left the platform's Blockradar wallet: spend the treasury reserve, and the bundles'
    -- naira value moves to the treasury NGN float.
    v_n := (v_txn.metadata->>'usdc_micro')::BIGINT + (v_txn.metadata->>'network_fee_micro')::BIGINT;
    UPDATE public.wallets SET locked_balance = GREATEST(0, locked_balance - v_n), updated_at = now()
      WHERE id = v_t_usdc;
    PERFORM public.debit_wallet(v_t_usdc, v_treasury, v_n, 0, 'withdrawal',
      'Bundles sold · treasury USDC out', 'blockradar', p_transaction_id::text || '-treasury-usdc-out',
      jsonb_build_object('bundle_sale_txn', p_transaction_id));
    PERFORM public.credit_wallet(public.get_treasury_wallet_id('NGN'), v_treasury, ABS(v_txn.net_amount), 0,
      'purchase', 'Bundles sold · treasury NGN in', 'internal', NULL,
      p_transaction_id::text || '-treasury-ngn-in', jsonb_build_object('bundle_sale_txn', p_transaction_id));
  END IF;
END;
$$;

CREATE OR REPLACE FUNCTION public.fail_bundle_sale(p_transaction_id UUID)
RETURNS VOID
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_txn public.transactions%ROWTYPE;
  v_n BIGINT;
BEGIN
  SELECT * INTO v_txn FROM public.transactions WHERE id = p_transaction_id FOR UPDATE;
  IF NOT FOUND THEN
    RAISE EXCEPTION 'Transaction not found: %', p_transaction_id;
  END IF;
  IF v_txn.status NOT IN ('pending', 'processing') THEN
    RETURN;
  END IF;

  PERFORM public.fail_withdrawal(p_transaction_id);

  IF v_txn.metadata->>'kind' = 'bundle_sale_usdc' THEN
    v_n := (v_txn.metadata->>'usdc_micro')::BIGINT + (v_txn.metadata->>'network_fee_micro')::BIGINT;
    UPDATE public.wallets SET locked_balance = GREATEST(0, locked_balance - v_n), updated_at = now()
      WHERE id = public.get_treasury_wallet_id('USDC');
  END IF;
END;
$$;

REVOKE ALL ON FUNCTION public.bundle_sale_daily_used_kobo(UUID) FROM PUBLIC, anon, authenticated;
REVOKE ALL ON FUNCTION public.create_bundle_sale(UUID, BIGINT, TEXT, JSONB, TEXT) FROM PUBLIC, anon, authenticated;
REVOKE ALL ON FUNCTION public.complete_bundle_sale(UUID) FROM PUBLIC, anon, authenticated;
REVOKE ALL ON FUNCTION public.fail_bundle_sale(UUID) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.bundle_sale_daily_used_kobo(UUID) TO service_role;
GRANT EXECUTE ON FUNCTION public.create_bundle_sale(UUID, BIGINT, TEXT, JSONB, TEXT) TO service_role;
GRANT EXECUTE ON FUNCTION public.complete_bundle_sale(UUID) TO service_role;
GRANT EXECUTE ON FUNCTION public.fail_bundle_sale(UUID) TO service_role;
