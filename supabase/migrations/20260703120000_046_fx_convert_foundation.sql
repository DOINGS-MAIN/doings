-- Migration 046: USDT↔NGN FX convert (Binance market rate, treasury ledger, 60s quotes)
-- =============================================================================

-- Treasury system user (ledger-only; no auth login)
INSERT INTO public.users (
  id,
  phone,
  email,
  full_name,
  username,
  kyc_level,
  status
) VALUES (
  '00000000-0000-4000-8000-000000000001',
  NULL,
  'treasury@doings.internal',
  'Platform Treasury',
  '__treasury__',
  2,
  'active'
) ON CONFLICT (id) DO NOTHING;

-- Ensure treasury wallets exist (trigger may not fire on conflict insert)
INSERT INTO public.wallets (user_id, currency, balance, locked_balance)
SELECT '00000000-0000-4000-8000-000000000001', c, 0, 0
FROM unnest(ARRAY['NGN'::public.currency, 'USDT'::public.currency]) AS c
ON CONFLICT (user_id, currency) DO NOTHING;

-- ── FX platform settings ──
ALTER TABLE public.platform_settings
  ADD COLUMN IF NOT EXISTS fx_enabled BOOLEAN NOT NULL DEFAULT false,
  ADD COLUMN IF NOT EXISTS fx_rate_source TEXT NOT NULL DEFAULT 'binance'
    CHECK (fx_rate_source IN ('binance', 'paycrest')),
  ADD COLUMN IF NOT EXISTS fx_market_rate_kobo BIGINT
    CHECK (fx_market_rate_kobo IS NULL OR fx_market_rate_kobo > 0),
  ADD COLUMN IF NOT EXISTS fx_market_rate_updated_at TIMESTAMPTZ,
  ADD COLUMN IF NOT EXISTS fx_sell_flat_kobo BIGINT NOT NULL DEFAULT 0
    CHECK (fx_sell_flat_kobo >= 0),
  ADD COLUMN IF NOT EXISTS fx_sell_percent NUMERIC(5, 2) NOT NULL DEFAULT 0
    CHECK (fx_sell_percent >= 0 AND fx_sell_percent <= 100),
  ADD COLUMN IF NOT EXISTS fx_buy_flat_kobo BIGINT NOT NULL DEFAULT 0
    CHECK (fx_buy_flat_kobo >= 0),
  ADD COLUMN IF NOT EXISTS fx_buy_percent NUMERIC(5, 2) NOT NULL DEFAULT 0
    CHECK (fx_buy_percent >= 0 AND fx_buy_percent <= 100),
  ADD COLUMN IF NOT EXISTS fx_sell_platform_fee_percent NUMERIC(5, 2) NOT NULL DEFAULT 0
    CHECK (fx_sell_platform_fee_percent >= 0 AND fx_sell_platform_fee_percent <= 100),
  ADD COLUMN IF NOT EXISTS fx_buy_platform_fee_percent NUMERIC(5, 2) NOT NULL DEFAULT 0
    CHECK (fx_buy_platform_fee_percent >= 0 AND fx_buy_platform_fee_percent <= 100),
  ADD COLUMN IF NOT EXISTS fx_daily_cap_usdt_micro BIGINT NOT NULL DEFAULT 10000000000
    CHECK (fx_daily_cap_usdt_micro > 0),
  ADD COLUMN IF NOT EXISTS fx_min_trade_usdt_micro BIGINT NOT NULL DEFAULT 5000000
    CHECK (fx_min_trade_usdt_micro > 0),
  ADD COLUMN IF NOT EXISTS fx_quote_ttl_seconds INT NOT NULL DEFAULT 60
    CHECK (fx_quote_ttl_seconds BETWEEN 30 AND 300);

COMMENT ON COLUMN public.platform_settings.fx_market_rate_kobo IS
  'Cached market rate: kobo credited per 1 whole USDT (e.g. 148550 = ₦1485.50/USDT).';

-- ── Market rate history ──
CREATE TABLE IF NOT EXISTS public.fx_rate_snapshots (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  source TEXT NOT NULL,
  market_rate_kobo BIGINT NOT NULL CHECK (market_rate_kobo > 0),
  sell_rate_kobo BIGINT NOT NULL CHECK (sell_rate_kobo > 0),
  buy_rate_kobo BIGINT NOT NULL CHECK (buy_rate_kobo > 0),
  raw_payload JSONB,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS idx_fx_rate_snapshots_created ON public.fx_rate_snapshots (created_at DESC);

ALTER TABLE public.fx_rate_snapshots ENABLE ROW LEVEL SECURITY;

-- ── Locked conversion quotes (60s TTL) ──
CREATE TABLE IF NOT EXISTS public.fx_quotes (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id UUID NOT NULL REFERENCES public.users(id) ON DELETE CASCADE,
  side TEXT NOT NULL CHECK (side IN ('sell', 'buy')),
  usdt_micro BIGINT NOT NULL CHECK (usdt_micro > 0),
  ngn_gross_kobo BIGINT NOT NULL CHECK (ngn_gross_kobo > 0),
  fee_kobo BIGINT NOT NULL DEFAULT 0 CHECK (fee_kobo >= 0),
  ngn_net_kobo BIGINT NOT NULL CHECK (ngn_net_kobo > 0),
  market_rate_kobo BIGINT NOT NULL CHECK (market_rate_kobo > 0),
  effective_rate_kobo BIGINT NOT NULL CHECK (effective_rate_kobo > 0),
  status TEXT NOT NULL DEFAULT 'pending'
    CHECK (status IN ('pending', 'executed', 'expired', 'cancelled')),
  expires_at TIMESTAMPTZ NOT NULL,
  executed_at TIMESTAMPTZ,
  swap_transaction_id UUID REFERENCES public.transactions(id),
  created_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS idx_fx_quotes_user_created ON public.fx_quotes (user_id, created_at DESC);
CREATE INDEX IF NOT EXISTS idx_fx_quotes_pending_expires ON public.fx_quotes (expires_at)
  WHERE status = 'pending';

ALTER TABLE public.fx_quotes ENABLE ROW LEVEL SECURITY;

-- ── Treasury top-up audit (ops manual credits) ──
CREATE TABLE IF NOT EXISTS public.treasury_topups (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  currency public.currency NOT NULL,
  amount BIGINT NOT NULL CHECK (amount > 0),
  reference TEXT,
  note TEXT,
  recorded_by UUID REFERENCES auth.users(id) ON DELETE SET NULL,
  transaction_id UUID REFERENCES public.transactions(id),
  created_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

ALTER TABLE public.treasury_topups ENABLE ROW LEVEL SECURITY;

-- ── Rate helpers ──
CREATE OR REPLACE FUNCTION public.fx_compute_sell_rate_kobo(
  p_market_kobo BIGINT,
  p_flat_kobo BIGINT,
  p_percent NUMERIC
)
RETURNS BIGINT
LANGUAGE sql
IMMUTABLE
AS $$
  SELECT GREATEST(
    1::BIGINT,
    p_market_kobo
      - COALESCE(p_flat_kobo, 0)
      - FLOOR(p_market_kobo * COALESCE(p_percent, 0) / 100)::BIGINT
  );
$$;

CREATE OR REPLACE FUNCTION public.fx_compute_buy_rate_kobo(
  p_market_kobo BIGINT,
  p_flat_kobo BIGINT,
  p_percent NUMERIC
)
RETURNS BIGINT
LANGUAGE sql
IMMUTABLE
AS $$
  SELECT GREATEST(
    1::BIGINT,
    p_market_kobo
      + COALESCE(p_flat_kobo, 0)
      + FLOOR(p_market_kobo * COALESCE(p_percent, 0) / 100)::BIGINT
  );
$$;

-- ── Daily swap volume per user (USDT micro equivalent) ──
CREATE OR REPLACE FUNCTION public.fx_user_daily_volume_usdt_micro(p_user_id UUID)
RETURNS BIGINT
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path = public
AS $$
  SELECT COALESCE(SUM(usdt_micro), 0)::BIGINT
  FROM public.fx_quotes
  WHERE user_id = p_user_id
    AND status = 'executed'
    AND executed_at >= date_trunc('day', now() AT TIME ZONE 'Africa/Lagos');
$$;

-- ── Treasury wallet IDs ──
CREATE OR REPLACE FUNCTION public.get_treasury_wallet_id(p_currency public.currency)
RETURNS UUID
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path = public
AS $$
  SELECT id
  FROM public.wallets
  WHERE user_id = '00000000-0000-4000-8000-000000000001'
    AND currency = p_currency
  LIMIT 1;
$$;

-- ── Public FX settings (rates + enabled flag; no admin secrets) ──
CREATE OR REPLACE FUNCTION public.get_fx_public_settings()
RETURNS jsonb
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path = public
AS $$
  SELECT jsonb_build_object(
    'enabled', fx_enabled,
    'market_rate_kobo', fx_market_rate_kobo,
    'market_rate_naira', CASE
      WHEN fx_market_rate_kobo IS NULL THEN NULL
      ELSE fx_market_rate_kobo::numeric / 100
    END,
    'market_rate_updated_at', fx_market_rate_updated_at,
    'sell_rate_kobo', CASE
      WHEN fx_market_rate_kobo IS NULL THEN NULL
      ELSE public.fx_compute_sell_rate_kobo(fx_market_rate_kobo, fx_sell_flat_kobo, fx_sell_percent)
    END,
    'buy_rate_kobo', CASE
      WHEN fx_market_rate_kobo IS NULL THEN NULL
      ELSE public.fx_compute_buy_rate_kobo(fx_market_rate_kobo, fx_buy_flat_kobo, fx_buy_percent)
    END,
    'sell_rate_naira', CASE
      WHEN fx_market_rate_kobo IS NULL THEN NULL
      ELSE public.fx_compute_sell_rate_kobo(fx_market_rate_kobo, fx_sell_flat_kobo, fx_sell_percent)::numeric / 100
    END,
    'buy_rate_naira', CASE
      WHEN fx_market_rate_kobo IS NULL THEN NULL
      ELSE public.fx_compute_buy_rate_kobo(fx_market_rate_kobo, fx_buy_flat_kobo, fx_buy_percent)::numeric / 100
    END,
    'sell_platform_fee_percent', fx_sell_platform_fee_percent,
    'buy_platform_fee_percent', fx_buy_platform_fee_percent,
    'min_trade_usdt', fx_min_trade_usdt_micro::numeric / 1000000,
    'quote_ttl_seconds', fx_quote_ttl_seconds
  )
  FROM public.platform_settings
  WHERE id = 1;
$$;

-- ── Admin FX settings ──
CREATE OR REPLACE FUNCTION public.get_fx_admin_settings()
RETURNS jsonb
LANGUAGE plpgsql
STABLE
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  _admin_id uuid := auth.uid();
BEGIN
  IF NOT (
    public.has_admin_role(_admin_id, 'super_admin')
    OR public.has_admin_role(_admin_id, 'finance')
    OR public.has_admin_role(_admin_id, 'support')
  ) THEN
    RAISE EXCEPTION 'Not authorized';
  END IF;

  RETURN (
    SELECT jsonb_build_object(
      'enabled', fx_enabled,
      'rate_source', fx_rate_source,
      'market_rate_kobo', fx_market_rate_kobo,
      'market_rate_naira', CASE
        WHEN fx_market_rate_kobo IS NULL THEN NULL
        ELSE fx_market_rate_kobo::numeric / 100
      END,
      'market_rate_updated_at', fx_market_rate_updated_at,
      'sell_flat_kobo', fx_sell_flat_kobo,
      'sell_flat_naira', fx_sell_flat_kobo::numeric / 100,
      'sell_percent', fx_sell_percent,
      'buy_flat_kobo', fx_buy_flat_kobo,
      'buy_flat_naira', fx_buy_flat_kobo::numeric / 100,
      'buy_percent', fx_buy_percent,
      'sell_rate_kobo', CASE
        WHEN fx_market_rate_kobo IS NULL THEN NULL
        ELSE public.fx_compute_sell_rate_kobo(fx_market_rate_kobo, fx_sell_flat_kobo, fx_sell_percent)
      END,
      'buy_rate_kobo', CASE
        WHEN fx_market_rate_kobo IS NULL THEN NULL
        ELSE public.fx_compute_buy_rate_kobo(fx_market_rate_kobo, fx_buy_flat_kobo, fx_buy_percent)
      END,
      'sell_rate_naira', CASE
        WHEN fx_market_rate_kobo IS NULL THEN NULL
        ELSE public.fx_compute_sell_rate_kobo(fx_market_rate_kobo, fx_sell_flat_kobo, fx_sell_percent)::numeric / 100
      END,
      'buy_rate_naira', CASE
        WHEN fx_market_rate_kobo IS NULL THEN NULL
        ELSE public.fx_compute_buy_rate_kobo(fx_market_rate_kobo, fx_buy_flat_kobo, fx_buy_percent)::numeric / 100
      END,
      'sell_platform_fee_percent', fx_sell_platform_fee_percent,
      'buy_platform_fee_percent', fx_buy_platform_fee_percent,
      'daily_cap_usdt', fx_daily_cap_usdt_micro::numeric / 1000000,
      'min_trade_usdt', fx_min_trade_usdt_micro::numeric / 1000000,
      'quote_ttl_seconds', fx_quote_ttl_seconds
    )
    FROM public.platform_settings
    WHERE id = 1
  );
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
  _daily_cap_usdt_micro bigint,
  _min_trade_usdt_micro bigint,
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

  IF _rate_source NOT IN ('binance', 'paycrest') THEN
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
      fx_daily_cap_usdt_micro = _daily_cap_usdt_micro,
      fx_min_trade_usdt_micro = _min_trade_usdt_micro,
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
      'rate_source', _rate_source
    )
  );
END;
$$;

CREATE OR REPLACE FUNCTION public.update_fx_market_rate(
  p_market_rate_kobo bigint,
  p_source text,
  p_raw_payload jsonb DEFAULT NULL
)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_sell BIGINT;
  v_buy BIGINT;
BEGIN
  IF p_market_rate_kobo IS NULL OR p_market_rate_kobo <= 0 THEN
    RAISE EXCEPTION 'Invalid market rate';
  END IF;

  SELECT
    public.fx_compute_sell_rate_kobo(p_market_rate_kobo, fx_sell_flat_kobo, fx_sell_percent),
    public.fx_compute_buy_rate_kobo(p_market_rate_kobo, fx_buy_flat_kobo, fx_buy_percent)
  INTO v_sell, v_buy
  FROM public.platform_settings
  WHERE id = 1;

  UPDATE public.platform_settings
  SET fx_market_rate_kobo = p_market_rate_kobo,
      fx_market_rate_updated_at = now()
  WHERE id = 1;

  INSERT INTO public.fx_rate_snapshots (source, market_rate_kobo, sell_rate_kobo, buy_rate_kobo, raw_payload)
  VALUES (p_source, p_market_rate_kobo, v_sell, v_buy, p_raw_payload);

  RETURN jsonb_build_object(
    'market_rate_kobo', p_market_rate_kobo,
    'sell_rate_kobo', v_sell,
    'buy_rate_kobo', v_buy
  );
END;
$$;

CREATE OR REPLACE FUNCTION public.get_treasury_balances()
RETURNS jsonb
LANGUAGE plpgsql
STABLE
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
    RAISE EXCEPTION 'Not authorized';
  END IF;

  RETURN jsonb_build_object(
    'ngn_balance', COALESCE((
      SELECT balance FROM public.wallets
      WHERE user_id = '00000000-0000-4000-8000-000000000001' AND currency = 'NGN'
    ), 0),
    'ngn_balance_naira', COALESCE((
      SELECT balance::numeric / 100 FROM public.wallets
      WHERE user_id = '00000000-0000-4000-8000-000000000001' AND currency = 'NGN'
    ), 0),
    'usdt_balance_micro', COALESCE((
      SELECT balance FROM public.wallets
      WHERE user_id = '00000000-0000-4000-8000-000000000001' AND currency = 'USDT'
    ), 0),
    'usdt_balance', COALESCE((
      SELECT balance::numeric / 1000000 FROM public.wallets
      WHERE user_id = '00000000-0000-4000-8000-000000000001' AND currency = 'USDT'
    ), 0)
  );
END;
$$;

CREATE OR REPLACE FUNCTION public.record_treasury_topup(
  p_currency public.currency,
  p_amount bigint,
  p_reference text DEFAULT NULL,
  p_note text DEFAULT NULL
)
RETURNS uuid
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  _admin_id uuid := auth.uid();
  v_wallet_id uuid;
  v_txn_id uuid;
  v_topup_id uuid;
  v_treasury_user uuid := '00000000-0000-4000-8000-000000000001';
BEGIN
  IF NOT (
    public.has_admin_role(_admin_id, 'super_admin')
    OR public.has_admin_role(_admin_id, 'finance')
  ) THEN
    RAISE EXCEPTION 'Only finance or super admins can record treasury top-ups';
  END IF;

  IF p_amount <= 0 THEN
    RAISE EXCEPTION 'Amount must be positive';
  END IF;

  v_wallet_id := public.get_treasury_wallet_id(p_currency);
  IF v_wallet_id IS NULL THEN
    RAISE EXCEPTION 'Treasury wallet not found for %', p_currency;
  END IF;

  v_txn_id := public.credit_wallet(
    v_wallet_id,
    v_treasury_user,
    p_amount,
    0,
    'deposit',
    COALESCE(p_note, 'Treasury top-up'),
    'internal',
    p_reference,
    'treasury-topup-' || gen_random_uuid()::text,
    jsonb_build_object('treasury_topup', true, 'recorded_by', _admin_id)
  );

  INSERT INTO public.treasury_topups (currency, amount, reference, note, recorded_by, transaction_id)
  VALUES (p_currency, p_amount, p_reference, p_note, _admin_id, v_txn_id)
  RETURNING id INTO v_topup_id;

  PERFORM public.log_admin_action(
    _admin_id,
    'record_treasury_topup',
    'treasury_topups',
    v_topup_id,
    jsonb_build_object('currency', p_currency, 'amount', p_amount, 'reference', p_reference)
  );

  RETURN v_topup_id;
END;
$$;

-- ── Create locked quote (service role / edge functions) ──
CREATE OR REPLACE FUNCTION public.create_fx_quote(
  p_user_id uuid,
  p_side text,
  p_usdt_micro bigint
)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_settings RECORD;
  v_market_kobo BIGINT;
  v_effective_kobo BIGINT;
  v_ngn_gross BIGINT;
  v_fee_kobo BIGINT;
  v_ngn_net BIGINT;
  v_fee_percent NUMERIC;
  v_ttl INT;
  v_quote_id UUID;
  v_expires TIMESTAMPTZ;
  v_daily BIGINT;
BEGIN
  IF p_side NOT IN ('sell', 'buy') THEN
    RAISE EXCEPTION 'side must be sell or buy';
  END IF;

  IF p_usdt_micro <= 0 THEN
    RAISE EXCEPTION 'Amount must be positive';
  END IF;

  SELECT * INTO v_settings FROM public.platform_settings WHERE id = 1;
  IF NOT v_settings.fx_enabled THEN
    RAISE EXCEPTION 'FX conversion is currently disabled';
  END IF;

  IF p_usdt_micro < v_settings.fx_min_trade_usdt_micro THEN
    RAISE EXCEPTION 'Minimum trade is % USDT', v_settings.fx_min_trade_usdt_micro::numeric / 1000000;
  END IF;

  v_market_kobo := v_settings.fx_market_rate_kobo;
  IF v_market_kobo IS NULL OR v_market_kobo <= 0 THEN
    RAISE EXCEPTION 'Market rate unavailable. Try again shortly.';
  END IF;

  v_daily := public.fx_user_daily_volume_usdt_micro(p_user_id);
  IF v_daily + p_usdt_micro > v_settings.fx_daily_cap_usdt_micro THEN
    RAISE EXCEPTION 'Daily conversion limit exceeded';
  END IF;

  IF p_side = 'sell' THEN
    v_effective_kobo := public.fx_compute_sell_rate_kobo(
      v_market_kobo, v_settings.fx_sell_flat_kobo, v_settings.fx_sell_percent
    );
    v_ngn_gross := FLOOR(p_usdt_micro::numeric * v_effective_kobo / 1000000)::BIGINT;
    v_fee_percent := v_settings.fx_sell_platform_fee_percent;
    v_fee_kobo := FLOOR(v_ngn_gross::numeric * v_fee_percent / 100)::BIGINT;
    v_ngn_net := v_ngn_gross - v_fee_kobo;
  ELSE
    v_effective_kobo := public.fx_compute_buy_rate_kobo(
      v_market_kobo, v_settings.fx_buy_flat_kobo, v_settings.fx_buy_percent
    );
    v_ngn_gross := CEIL(p_usdt_micro::numeric * v_effective_kobo / 1000000)::BIGINT;
    v_fee_percent := v_settings.fx_buy_platform_fee_percent;
    v_fee_kobo := FLOOR(v_ngn_gross::numeric * v_fee_percent / 100)::BIGINT;
    v_ngn_net := v_ngn_gross + v_fee_kobo;
  END IF;

  IF v_ngn_net <= 0 THEN
    RAISE EXCEPTION 'Trade amount too small at current rate';
  END IF;

  v_ttl := v_settings.fx_quote_ttl_seconds;
  v_expires := now() + make_interval(secs => v_ttl);

  INSERT INTO public.fx_quotes (
    user_id, side, usdt_micro, ngn_gross_kobo, fee_kobo, ngn_net_kobo,
    market_rate_kobo, effective_rate_kobo, expires_at
  ) VALUES (
    p_user_id, p_side, p_usdt_micro, v_ngn_gross, v_fee_kobo, v_ngn_net,
    v_market_kobo, v_effective_kobo, v_expires
  )
  RETURNING id INTO v_quote_id;

  RETURN jsonb_build_object(
    'quote_id', v_quote_id,
    'side', p_side,
    'usdt_micro', p_usdt_micro,
    'usdt', p_usdt_micro::numeric / 1000000,
    'ngn_gross_kobo', v_ngn_gross,
    'fee_kobo', v_fee_kobo,
    'ngn_net_kobo', v_ngn_net,
    'ngn_gross', v_ngn_gross::numeric / 100,
    'fee_naira', v_fee_kobo::numeric / 100,
    'ngn_net', v_ngn_net::numeric / 100,
    'market_rate_kobo', v_market_kobo,
    'market_rate_naira', v_market_kobo::numeric / 100,
    'effective_rate_kobo', v_effective_kobo,
    'effective_rate_naira', v_effective_kobo::numeric / 100,
    'platform_fee_percent', v_fee_percent,
    'expires_at', v_expires,
    'ttl_seconds', v_ttl
  );
END;
$$;

-- ── Execute swap against a locked quote ──
CREATE OR REPLACE FUNCTION public.execute_fx_swap(
  p_quote_id uuid,
  p_user_id uuid
)
RETURNS uuid
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_quote RECORD;
  v_user_ngn_wallet uuid;
  v_user_usdt_wallet uuid;
  v_treasury_ngn uuid;
  v_treasury_usdt uuid;
  v_treasury_user uuid := '00000000-0000-4000-8000-000000000001';
  v_swap_txn_id uuid;
  v_idem text;
  v_treasury_ngn_bal bigint;
  v_treasury_usdt_bal bigint;
BEGIN
  SELECT * INTO v_quote
  FROM public.fx_quotes
  WHERE id = p_quote_id
  FOR UPDATE;

  IF NOT FOUND THEN
    RAISE EXCEPTION 'Quote not found';
  END IF;

  IF v_quote.user_id != p_user_id THEN
    RAISE EXCEPTION 'Quote does not belong to user';
  END IF;

  IF v_quote.status != 'pending' THEN
    RAISE EXCEPTION 'Quote is no longer valid';
  END IF;

  IF v_quote.expires_at < now() THEN
    UPDATE public.fx_quotes SET status = 'expired' WHERE id = p_quote_id;
    RAISE EXCEPTION 'Quote expired';
  END IF;

  SELECT id INTO v_user_ngn_wallet FROM public.wallets WHERE user_id = p_user_id AND currency = 'NGN';
  SELECT id INTO v_user_usdt_wallet FROM public.wallets WHERE user_id = p_user_id AND currency = 'USDT';
  v_treasury_ngn := public.get_treasury_wallet_id('NGN');
  v_treasury_usdt := public.get_treasury_wallet_id('USDT');

  IF v_user_ngn_wallet IS NULL OR v_user_usdt_wallet IS NULL THEN
    RAISE EXCEPTION 'User wallets not found';
  END IF;

  IF v_treasury_ngn IS NULL OR v_treasury_usdt IS NULL THEN
    RAISE EXCEPTION 'Treasury wallets not configured';
  END IF;

  v_idem := 'fx-swap-' || p_quote_id::text;

  IF v_quote.side = 'sell' THEN
    SELECT balance INTO v_treasury_ngn_bal
    FROM public.wallets WHERE id = v_treasury_ngn FOR UPDATE;

    IF v_treasury_ngn_bal < v_quote.ngn_net_kobo THEN
      RAISE EXCEPTION 'Insufficient conversion liquidity. Try a smaller amount or later.';
    END IF;

    PERFORM public.debit_wallet(
      v_user_usdt_wallet, p_user_id, v_quote.usdt_micro, 0,
      'swap', 'Sold USDT for NGN', 'internal', v_idem || '-usdt-out',
      jsonb_build_object('quote_id', p_quote_id, 'side', 'sell')
    );

    PERFORM public.credit_wallet(
      v_treasury_usdt, v_treasury_user, v_quote.usdt_micro, 0,
      'swap', 'FX: received USDT from user', 'internal', NULL, v_idem || '-treasury-usdt-in',
      jsonb_build_object('quote_id', p_quote_id, 'side', 'sell')
    );

    PERFORM public.debit_wallet(
      v_treasury_ngn, v_treasury_user, v_quote.ngn_net_kobo, 0,
      'swap', 'FX: paid NGN to user', 'internal', v_idem || '-treasury-ngn-out',
      jsonb_build_object('quote_id', p_quote_id, 'side', 'sell')
    );

    v_swap_txn_id := public.credit_wallet(
      v_user_ngn_wallet, p_user_id, v_quote.ngn_net_kobo, 0,
      'swap', 'Received NGN from USDT sale', 'internal', NULL, v_idem || '-ngn-in',
      jsonb_build_object(
        'quote_id', p_quote_id,
        'side', 'sell',
        'usdt_micro', v_quote.usdt_micro,
        'ngn_gross_kobo', v_quote.ngn_gross_kobo,
        'fee_kobo', v_quote.fee_kobo,
        'market_rate_kobo', v_quote.market_rate_kobo,
        'effective_rate_kobo', v_quote.effective_rate_kobo
      )
    );
  ELSE
    SELECT balance INTO v_treasury_usdt_bal
    FROM public.wallets WHERE id = v_treasury_usdt FOR UPDATE;

    IF v_treasury_usdt_bal < v_quote.usdt_micro THEN
      RAISE EXCEPTION 'Insufficient USDT liquidity. Try a smaller amount or later.';
    END IF;

    PERFORM public.debit_wallet(
      v_user_ngn_wallet, p_user_id, v_quote.ngn_net_kobo, 0,
      'swap', 'Bought USDT with NGN', 'internal', v_idem || '-ngn-out',
      jsonb_build_object('quote_id', p_quote_id, 'side', 'buy')
    );

    PERFORM public.credit_wallet(
      v_treasury_ngn, v_treasury_user, v_quote.ngn_net_kobo, 0,
      'swap', 'FX: received NGN from user', 'internal', NULL, v_idem || '-treasury-ngn-in',
      jsonb_build_object('quote_id', p_quote_id, 'side', 'buy')
    );

    PERFORM public.debit_wallet(
      v_treasury_usdt, v_treasury_user, v_quote.usdt_micro, 0,
      'swap', 'FX: paid USDT to user', 'internal', v_idem || '-treasury-usdt-out',
      jsonb_build_object('quote_id', p_quote_id, 'side', 'buy')
    );

    v_swap_txn_id := public.credit_wallet(
      v_user_usdt_wallet, p_user_id, v_quote.usdt_micro, 0,
      'swap', 'Received USDT from NGN purchase', 'internal', NULL, v_idem || '-usdt-in',
      jsonb_build_object(
        'quote_id', p_quote_id,
        'side', 'buy',
        'usdt_micro', v_quote.usdt_micro,
        'ngn_gross_kobo', v_quote.ngn_gross_kobo,
        'fee_kobo', v_quote.fee_kobo,
        'market_rate_kobo', v_quote.market_rate_kobo,
        'effective_rate_kobo', v_quote.effective_rate_kobo
      )
    );
  END IF;

  UPDATE public.fx_quotes
  SET status = 'executed',
      executed_at = now(),
      swap_transaction_id = v_swap_txn_id
  WHERE id = p_quote_id;

  RETURN v_swap_txn_id;
END;
$$;

GRANT EXECUTE ON FUNCTION public.get_fx_public_settings() TO authenticated;
GRANT EXECUTE ON FUNCTION public.get_fx_admin_settings() TO authenticated;
GRANT EXECUTE ON FUNCTION public.set_fx_settings(boolean, text, bigint, numeric, bigint, numeric, numeric, numeric, bigint, bigint, int) TO authenticated;
GRANT EXECUTE ON FUNCTION public.get_treasury_balances() TO authenticated;
GRANT EXECUTE ON FUNCTION public.record_treasury_topup(public.currency, bigint, text, text) TO authenticated;
GRANT EXECUTE ON FUNCTION public.create_fx_quote(uuid, text, bigint) TO service_role;
GRANT EXECUTE ON FUNCTION public.execute_fx_swap(uuid, uuid) TO service_role;
GRANT EXECUTE ON FUNCTION public.update_fx_market_rate(bigint, text, jsonb) TO service_role;
