-- Bundles phase 2: buying bundles (NGN via Flutterwave checkout, USDC via deposit -> conversion).
-- 1 bundle = bundle_price_kobo (100 = ₦1) on the NGN ledger. All functions here are service-role
-- only; the `bundles` edge function and the payment webhooks call them.

-- ── Settings ──
ALTER TABLE public.platform_settings
  ADD COLUMN IF NOT EXISTS bundle_price_kobo BIGINT NOT NULL DEFAULT 100 CHECK (bundle_price_kobo > 0),
  ADD COLUMN IF NOT EXISTS bundle_fee_flat_kobo BIGINT NOT NULL DEFAULT 15000 CHECK (bundle_fee_flat_kobo >= 0),
  ADD COLUMN IF NOT EXISTS bundle_fee_percent NUMERIC(5,2) NOT NULL DEFAULT 0 CHECK (bundle_fee_percent >= 0 AND bundle_fee_percent <= 50),
  ADD COLUMN IF NOT EXISTS bundle_min_purchase BIGINT NOT NULL DEFAULT 10000 CHECK (bundle_min_purchase > 0),
  ADD COLUMN IF NOT EXISTS bundle_usdc_enabled BOOLEAN NOT NULL DEFAULT true,
  ADD COLUMN IF NOT EXISTS bundle_usdc_min_micro BIGINT NOT NULL DEFAULT 5000000 CHECK (bundle_usdc_min_micro > 0);

-- ── Orders ──
CREATE TABLE IF NOT EXISTS public.bundle_orders (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id UUID NOT NULL REFERENCES public.users(id) ON DELETE CASCADE,
  currency public.currency NOT NULL,
  -- NGN: bundles ordered. USDC: bundles credited (set on conversion).
  bundles BIGINT NOT NULL DEFAULT 0 CHECK (bundles >= 0),
  fee_kobo BIGINT NOT NULL DEFAULT 0 CHECK (fee_kobo >= 0),
  -- NGN: total due in kobo. USDC: micro-USDC received.
  amount BIGINT NOT NULL CHECK (amount > 0),
  tx_ref TEXT NOT NULL UNIQUE,
  status TEXT NOT NULL DEFAULT 'awaiting_payment'
    CHECK (status IN ('awaiting_payment', 'credited', 'pending_float', 'below_minimum', 'failed', 'expired')),
  provider TEXT,
  provider_ref TEXT,
  wallet_id UUID REFERENCES public.wallets(id),
  credit_transaction_id UUID REFERENCES public.transactions(id),
  failure_reason TEXT,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now()
);
CREATE INDEX IF NOT EXISTS idx_bundle_orders_user ON public.bundle_orders (user_id, created_at DESC);
CREATE INDEX IF NOT EXISTS idx_bundle_orders_status ON public.bundle_orders (status) WHERE status IN ('awaiting_payment', 'pending_float');

ALTER TABLE public.bundle_orders ENABLE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS "Users can view own bundle orders" ON public.bundle_orders;
CREATE POLICY "Users can view own bundle orders"
  ON public.bundle_orders FOR SELECT TO authenticated
  USING (user_id IN (SELECT u.id FROM public.users u WHERE u.auth_id = auth.uid()));
REVOKE INSERT, UPDATE, DELETE ON public.bundle_orders FROM anon, authenticated;

-- ── debit_wallet: 'purchase' joins spray / giveaway at level 1 (075 definition otherwise unchanged) ──
CREATE OR REPLACE FUNCTION public.debit_wallet(p_wallet_id uuid, p_user_id uuid, p_amount bigint, p_fee bigint DEFAULT 0, p_type transaction_type DEFAULT 'send'::transaction_type, p_description text DEFAULT ''::text, p_provider character varying DEFAULT 'internal'::character varying, p_idempotency_key character varying DEFAULT NULL::character varying, p_metadata jsonb DEFAULT NULL::jsonb)
 RETURNS uuid
 LANGUAGE plpgsql
 SECURITY DEFINER
AS $$
DECLARE
  v_txn_id UUID;
  v_balance_before BIGINT;
  v_locked_balance BIGINT;
  v_available BIGINT;
  v_total_debit BIGINT;
  v_wallet_currency currency;
  v_kyc SMALLINT;
  v_required_kyc SMALLINT;
BEGIN
  IF p_idempotency_key IS NULL THEN
    p_idempotency_key := 'auto-' || gen_random_uuid()::text;
  END IF;

  SELECT id INTO v_txn_id
  FROM public.transactions
  WHERE idempotency_key = p_idempotency_key;

  IF v_txn_id IS NOT NULL THEN
    RETURN v_txn_id;
  END IF;

  v_total_debit := p_amount + p_fee;

  SELECT kyc_level INTO v_kyc FROM public.users WHERE id = p_user_id;
  IF NOT FOUND THEN
    RAISE EXCEPTION 'User not found: %', p_user_id;
  END IF;

  -- Bundles model: spraying, giveaways and bundle purchases (USDC -> bundles, server-only) need a
  -- verified email (level 1); every other debit
  -- (sell / cash-out, transfers, conversions) still needs BVN + NIN (level 2).
  IF p_type IN ('spray', 'giveaway', 'purchase') THEN
    v_required_kyc := 1;
  ELSE
    v_required_kyc := 2;
  END IF;
  IF v_total_debit > 0 AND v_kyc < v_required_kyc THEN
    IF v_required_kyc = 1 THEN
      RAISE EXCEPTION 'Verify your email to spray, create giveaways or buy bundles';
    END IF;
    RAISE EXCEPTION 'Complete identity verification (BVN + NIN) to send or spend funds';
  END IF;

  SELECT balance, locked_balance, currency
  INTO v_balance_before, v_locked_balance, v_wallet_currency
  FROM public.wallets
  WHERE id = p_wallet_id
  FOR UPDATE;

  IF NOT FOUND THEN
    RAISE EXCEPTION 'Wallet not found: %', p_wallet_id;
  END IF;

  v_available := v_balance_before - v_locked_balance;
  IF v_available < v_total_debit THEN
    RAISE EXCEPTION 'Insufficient balance. Available: %, Required: %', v_available, v_total_debit;
  END IF;

  UPDATE public.wallets
  SET balance = balance - v_total_debit,
      updated_at = now()
  WHERE id = p_wallet_id;

  INSERT INTO public.transactions (
    wallet_id, user_id, currency, type, amount, fee,
    net_amount, status, provider, idempotency_key,
    description, metadata, completed_at
  ) VALUES (
    p_wallet_id, p_user_id, v_wallet_currency, p_type, -p_amount, p_fee,
    -v_total_debit, 'completed', p_provider, p_idempotency_key,
    p_description, p_metadata, now()
  )
  RETURNING id INTO v_txn_id;

  INSERT INTO public.ledger_entries (
    transaction_id, wallet_id, entry_type, amount, balance_before, balance_after
  ) VALUES (
    v_txn_id, p_wallet_id, 'debit', v_total_debit, v_balance_before, v_balance_before - v_total_debit
  );

  RETURN v_txn_id;
END;
$$;

-- ── NGN: credit a paid Flutterwave checkout order, once ──
CREATE OR REPLACE FUNCTION public.settle_ngn_bundle_order(
  p_tx_ref TEXT,
  p_paid_kobo BIGINT,
  p_currency TEXT,
  p_provider_ref TEXT
)
RETURNS JSONB
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_order public.bundle_orders%ROWTYPE;
  v_price BIGINT;
  v_wallet UUID;
  v_txn UUID;
BEGIN
  SELECT * INTO v_order FROM public.bundle_orders WHERE tx_ref = p_tx_ref FOR UPDATE;
  IF NOT FOUND THEN
    RAISE EXCEPTION 'Bundle order not found: %', p_tx_ref;
  END IF;
  IF v_order.status = 'credited' THEN
    RETURN jsonb_build_object('order_id', v_order.id, 'status', 'credited', 'already', true,
      'bundles', v_order.bundles);
  END IF;
  IF v_order.currency <> 'NGN' THEN
    RAISE EXCEPTION 'Not an NGN bundle order';
  END IF;
  IF upper(COALESCE(p_currency, '')) <> 'NGN' OR COALESCE(p_paid_kobo, 0) < v_order.amount THEN
    UPDATE public.bundle_orders
      SET status = 'failed', provider_ref = p_provider_ref,
          failure_reason = format('Paid %s %s, expected %s NGN kobo', p_paid_kobo, p_currency, v_order.amount),
          updated_at = now()
      WHERE id = v_order.id;
    RETURN jsonb_build_object('order_id', v_order.id, 'status', 'failed');
  END IF;

  SELECT bundle_price_kobo INTO v_price FROM public.platform_settings LIMIT 1;
  SELECT id INTO v_wallet FROM public.wallets WHERE user_id = v_order.user_id AND currency = 'NGN';
  IF v_wallet IS NULL THEN
    RAISE EXCEPTION 'NGN wallet not found for user %', v_order.user_id;
  END IF;

  v_txn := public.credit_wallet(
    v_wallet, v_order.user_id, v_order.bundles * v_price, 0, 'purchase',
    format('Bought %s bundles', v_order.bundles), 'flutterwave', p_provider_ref,
    'bundle-order-' || v_order.id::text,
    jsonb_build_object('bundle_order_id', v_order.id, 'bundles', v_order.bundles,
      'paid_kobo', p_paid_kobo, 'fee_kobo', v_order.fee_kobo)
  );

  UPDATE public.bundle_orders
    SET status = 'credited', provider_ref = p_provider_ref, wallet_id = v_wallet,
        credit_transaction_id = v_txn, failure_reason = NULL, updated_at = now()
    WHERE id = v_order.id;
  RETURN jsonb_build_object('order_id', v_order.id, 'status', 'credited', 'bundles', v_order.bundles);
END;
$$;

-- ── USDC: convert a confirmed deposit into bundles via the treasury float ──
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

-- ── Reconciliation helpers (cron) ──
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
  FOR r IN
    SELECT o.user_id, o.wallet_id, o.amount, o.provider_ref
    FROM public.bundle_orders o
    WHERE o.status = 'pending_float' AND o.currency = 'USDC'
    ORDER BY o.created_at
    LIMIT 50
  LOOP
    BEGIN
      IF (public.convert_usdc_deposit_to_bundles(r.user_id, r.wallet_id, r.amount, r.provider_ref)->>'status') = 'credited' THEN
        n := n + 1;
      END IF;
    EXCEPTION WHEN OTHERS THEN
      NULL; -- keep it pending; next run retries
    END;
  END LOOP;
  RETURN n;
END;
$$;

CREATE OR REPLACE FUNCTION public.expire_stale_bundle_orders()
RETURNS INT
LANGUAGE sql
SECURITY DEFINER
SET search_path = public
AS $$
  WITH x AS (
    UPDATE public.bundle_orders SET status = 'expired', updated_at = now()
    WHERE status = 'awaiting_payment' AND currency = 'NGN' AND created_at < now() - interval '24 hours'
    RETURNING 1
  )
  SELECT count(*)::INT FROM x;
$$;

REVOKE ALL ON FUNCTION public.settle_ngn_bundle_order(TEXT, BIGINT, TEXT, TEXT) FROM PUBLIC, anon, authenticated;
REVOKE ALL ON FUNCTION public.convert_usdc_deposit_to_bundles(UUID, UUID, BIGINT, TEXT) FROM PUBLIC, anon, authenticated;
REVOKE ALL ON FUNCTION public.retry_pending_bundle_orders() FROM PUBLIC, anon, authenticated;
REVOKE ALL ON FUNCTION public.expire_stale_bundle_orders() FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.settle_ngn_bundle_order(TEXT, BIGINT, TEXT, TEXT) TO service_role;
GRANT EXECUTE ON FUNCTION public.convert_usdc_deposit_to_bundles(UUID, UUID, BIGINT, TEXT) TO service_role;
GRANT EXECUTE ON FUNCTION public.retry_pending_bundle_orders() TO service_role;
GRANT EXECUTE ON FUNCTION public.expire_stale_bundle_orders() TO service_role;
