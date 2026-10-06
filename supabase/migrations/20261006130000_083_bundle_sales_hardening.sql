-- Bundles phase 3 hardening (review minors):
--   * Daily withdrawal limit is a setting (withdrawal_daily_limit_l2_kobo), shared by bundle sales
--     and the old-app NGN withdrawal, which now locks through lock_ngn_withdrawal_checked under the
--     same per-user advisory lock (no concurrent overshoot).
--   * create_bundle_sale refuses an idempotency key that lock_withdrawal matched to another user's
--     transaction, and a USDC replay no longer reports an NGN payout.
--   * Treasury reserve releases record drift on the sale (metadata.reserve_drift) instead of hiding it.
--   * merge_transaction_metadata: atomic metadata patch for edge functions.

ALTER TABLE public.platform_settings
  ADD COLUMN IF NOT EXISTS withdrawal_daily_limit_l2_kobo BIGINT NOT NULL DEFAULT 200000000
    CHECK (withdrawal_daily_limit_l2_kobo > 0);

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
      'payout_kobo', CASE WHEN v_existing.metadata->>'kind' = 'bundle_sale_usdc' THEN NULL ELSE ABS(v_existing.amount) END,
      'usdc_micro', (v_existing.metadata->>'usdc_micro')::BIGINT);
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

  IF public.bundle_sale_daily_used_kobo(p_user_id) + v_value > v_s.withdrawal_daily_limit_l2_kobo THEN
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
    IF (SELECT user_id FROM public.transactions WHERE id = v_txn) <> p_user_id THEN
      RAISE EXCEPTION 'Idempotency key already used';
    END IF;
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
  IF (SELECT user_id FROM public.transactions WHERE id = v_txn) <> p_user_id THEN
      RAISE EXCEPTION 'Idempotency key already used';
    END IF;
  RETURN jsonb_build_object('transaction_id', v_txn, 'reference', p_idempotency_key, 'status', 'pending',
    'currency', 'USDC', 'bundles', p_bundles, 'fee_kobo', v_fee, 'usdc_micro', v_usdc,
    'network_fee_micro', v_net_fee, 'rate_kobo', v_rate);
END;
$$;

CREATE OR REPLACE FUNCTION public.lock_ngn_withdrawal_checked(
  p_wallet_id UUID,
  p_user_id UUID,
  p_amount BIGINT,
  p_fee BIGINT,
  p_provider VARCHAR,
  p_provider_ref VARCHAR,
  p_idempotency_key VARCHAR,
  p_description TEXT,
  p_metadata JSONB
)
RETURNS UUID
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_limit BIGINT;
  v_txn UUID;
BEGIN
  -- Same per-user lock as create_bundle_sale, so the two cash-out paths can't overshoot together.
  PERFORM pg_advisory_xact_lock(hashtext('bundle-sale:' || p_user_id::text));
  SELECT withdrawal_daily_limit_l2_kobo INTO v_limit FROM public.platform_settings LIMIT 1;
  IF public.bundle_sale_daily_used_kobo(p_user_id) + p_amount + p_fee > v_limit THEN
    RAISE EXCEPTION 'Daily withdrawal limit exceeded';
  END IF;
  v_txn := public.lock_withdrawal(p_wallet_id, p_user_id, p_amount, p_fee, 'withdrawal', p_description,
    p_provider, p_provider_ref, p_idempotency_key, p_metadata);
  IF (SELECT user_id FROM public.transactions WHERE id = v_txn) <> p_user_id THEN
    RAISE EXCEPTION 'Idempotency key already used';
  END IF;
  RETURN v_txn;
END;
$$;

CREATE OR REPLACE FUNCTION public.merge_transaction_metadata(p_transaction_id UUID, p_patch JSONB)
RETURNS VOID
LANGUAGE sql
SECURITY DEFINER
SET search_path = public
AS $$
  UPDATE public.transactions
    SET metadata = COALESCE(metadata, '{}'::jsonb) || COALESCE(p_patch, '{}'::jsonb), updated_at = now()
    WHERE id = p_transaction_id;
$$;

CREATE OR REPLACE FUNCTION public.release_treasury_usdc_reserve(p_transaction_id UUID, p_amount BIGINT)
RETURNS VOID
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_t_usdc UUID := public.get_treasury_wallet_id('USDC');
  v_locked BIGINT;
BEGIN
  SELECT locked_balance INTO v_locked FROM public.wallets WHERE id = v_t_usdc FOR UPDATE;
  IF COALESCE(v_locked, 0) < p_amount THEN
    -- Should never happen; keep going (the payout outcome is real) but leave a trail for admins.
    PERFORM public.merge_transaction_metadata(p_transaction_id,
      jsonb_build_object('reserve_drift', true, 'reserve_locked_at_release', COALESCE(v_locked, 0)));
  END IF;
  UPDATE public.wallets SET locked_balance = GREATEST(0, locked_balance - p_amount), updated_at = now()
    WHERE id = v_t_usdc;
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
    v_n := (v_txn.metadata->>'usdc_micro')::BIGINT + (v_txn.metadata->>'network_fee_micro')::BIGINT;
    PERFORM public.release_treasury_usdc_reserve(p_transaction_id, v_n);
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
    PERFORM public.release_treasury_usdc_reserve(p_transaction_id,
      (v_txn.metadata->>'usdc_micro')::BIGINT + (v_txn.metadata->>'network_fee_micro')::BIGINT);
  END IF;
END;
$$;

REVOKE ALL ON FUNCTION public.create_bundle_sale(UUID, BIGINT, TEXT, JSONB, TEXT) FROM PUBLIC, anon, authenticated;
REVOKE ALL ON FUNCTION public.complete_bundle_sale(UUID) FROM PUBLIC, anon, authenticated;
REVOKE ALL ON FUNCTION public.fail_bundle_sale(UUID) FROM PUBLIC, anon, authenticated;
REVOKE ALL ON FUNCTION public.lock_ngn_withdrawal_checked(UUID, UUID, BIGINT, BIGINT, VARCHAR, VARCHAR, VARCHAR, TEXT, JSONB) FROM PUBLIC, anon, authenticated;
REVOKE ALL ON FUNCTION public.merge_transaction_metadata(UUID, JSONB) FROM PUBLIC, anon, authenticated;
REVOKE ALL ON FUNCTION public.release_treasury_usdc_reserve(UUID, BIGINT) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.create_bundle_sale(UUID, BIGINT, TEXT, JSONB, TEXT) TO service_role;
GRANT EXECUTE ON FUNCTION public.complete_bundle_sale(UUID) TO service_role;
GRANT EXECUTE ON FUNCTION public.fail_bundle_sale(UUID) TO service_role;
GRANT EXECUTE ON FUNCTION public.lock_ngn_withdrawal_checked(UUID, UUID, BIGINT, BIGINT, VARCHAR, VARCHAR, VARCHAR, TEXT, JSONB) TO service_role;
GRANT EXECUTE ON FUNCTION public.merge_transaction_metadata(UUID, JSONB) TO service_role;
GRANT EXECUTE ON FUNCTION public.release_treasury_usdc_reserve(UUID, BIGINT) TO service_role;
