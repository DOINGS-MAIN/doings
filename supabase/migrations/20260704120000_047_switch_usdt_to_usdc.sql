-- Migration 047: Switch stablecoin rail from USDT to USDC (Tron TRC-20)
-- =============================================================================

ALTER TYPE public.currency RENAME VALUE 'USDT' TO 'USDC';

ALTER TABLE public.platform_settings
  RENAME COLUMN fx_daily_cap_usdt_micro TO fx_daily_cap_usdc_micro;
ALTER TABLE public.platform_settings
  RENAME COLUMN fx_min_trade_usdt_micro TO fx_min_trade_usdc_micro;

ALTER TABLE public.fx_quotes RENAME COLUMN usdt_micro TO usdc_micro;

COMMENT ON COLUMN public.platform_settings.fx_market_rate_kobo IS
  'Cached market rate: kobo credited per 1 whole USDC (e.g. 148550 = ₦1485.50/USDC).';

CREATE OR REPLACE FUNCTION public.create_user_wallets()
RETURNS TRIGGER AS $$
BEGIN
  INSERT INTO public.wallets (user_id, currency) VALUES
    (NEW.id, 'NGN'),
    (NEW.id, 'USDC');
  RETURN NEW;
END;
$$ LANGUAGE plpgsql SECURITY DEFINER;

CREATE OR REPLACE FUNCTION public.notify_transaction_status()
RETURNS TRIGGER AS $$
DECLARE
  v_title TEXT;
  v_body TEXT;
  v_type TEXT;
  v_currency TEXT;
  v_display_amount TEXT;
BEGIN
  IF OLD.status = NEW.status THEN RETURN NEW; END IF;
  IF NEW.status NOT IN ('completed', 'failed') THEN RETURN NEW; END IF;
  IF NEW.type NOT IN ('deposit', 'withdrawal') THEN RETURN NEW; END IF;

  SELECT currency INTO v_currency FROM public.wallets WHERE id = NEW.wallet_id;

  IF v_currency = 'NGN' THEN
    v_display_amount := '₦' || TRIM(to_char(ABS(NEW.amount) / 100.0, '999,999,999.00'));
  ELSE
    v_display_amount := TRIM(to_char(ABS(NEW.amount) / 1000000.0, '999,999.00')) || ' USDC';
  END IF;

  IF NEW.type = 'deposit' AND NEW.status = 'completed' THEN
    v_type := 'deposit_completed';
    v_title := 'Deposit received';
    v_body := v_display_amount || ' has been credited to your wallet.';
  ELSIF NEW.type = 'withdrawal' AND NEW.status = 'completed' THEN
    v_type := 'withdrawal_completed';
    v_title := 'Withdrawal successful';
    v_body := v_display_amount || ' has been sent to your account.';
  ELSIF NEW.type = 'withdrawal' AND NEW.status = 'failed' THEN
    v_type := 'withdrawal_failed';
    v_title := 'Withdrawal failed';
    v_body := v_display_amount || ' withdrawal failed. Funds have been released back to your wallet.';
  ELSE
    RETURN NEW;
  END IF;

  PERFORM public.create_notification(
    NEW.user_id, v_type, v_title, v_body,
    jsonb_build_object('transaction_id', NEW.id, 'amount', ABS(NEW.amount), 'currency', v_currency)
  );

  RETURN NEW;
END;
$$ LANGUAGE plpgsql SECURITY DEFINER SET search_path = public;

CREATE OR REPLACE FUNCTION public.notify_deposit_insert()
RETURNS TRIGGER AS $$
DECLARE
  v_currency TEXT;
  v_display_amount TEXT;
BEGIN
  IF NEW.type != 'deposit' OR NEW.status != 'completed' THEN RETURN NEW; END IF;

  SELECT currency INTO v_currency FROM public.wallets WHERE id = NEW.wallet_id;

  IF v_currency = 'NGN' THEN
    v_display_amount := '₦' || TRIM(to_char(ABS(NEW.amount) / 100.0, '999,999,999.00'));
  ELSE
    v_display_amount := TRIM(to_char(ABS(NEW.amount) / 1000000.0, '999,999.00')) || ' USDC';
  END IF;

  BEGIN
    PERFORM public.create_notification(
      NEW.user_id, 'deposit_completed', 'Deposit received',
      v_display_amount || ' has been credited to your wallet.',
      jsonb_build_object('transaction_id', NEW.id, 'amount', ABS(NEW.amount), 'currency', v_currency)
    );
  EXCEPTION WHEN OTHERS THEN
    RAISE WARNING 'notify_deposit_insert failed for txn %: %', NEW.id, SQLERRM;
  END;

  RETURN NEW;
END;
$$ LANGUAGE plpgsql SECURITY DEFINER SET search_path = public;

DROP FUNCTION IF EXISTS public.fx_user_daily_volume_usdt_micro(uuid);
DROP FUNCTION IF EXISTS public.set_fx_settings(boolean, text, bigint, numeric, bigint, numeric, numeric, numeric, bigint, bigint, int);
DROP FUNCTION IF EXISTS public.create_fx_quote(uuid, text, bigint);

-- ── Daily swap volume per user (USDC micro equivalent) ──
CREATE OR REPLACE FUNCTION public.fx_user_daily_volume_usdc_micro(p_user_id UUID)
RETURNS BIGINT
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path = public
AS $$
  SELECT COALESCE(SUM(usdc_micro), 0)::BIGINT
  FROM public.fx_quotes
  WHERE user_id = p_user_id
    AND status = 'executed'
    AND executed_at >= date_trunc('day', now() AT TIME ZONE 'Africa/Lagos');
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
    'min_trade_usdc', fx_min_trade_usdc_micro::numeric / 1000000,
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
      'daily_cap_usdc', fx_daily_cap_usdc_micro::numeric / 1000000,
      'min_trade_usdc', fx_min_trade_usdc_micro::numeric / 1000000,
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
    'usdc_balance_micro', COALESCE((
      SELECT balance FROM public.wallets
      WHERE user_id = '00000000-0000-4000-8000-000000000001' AND currency = 'USDC'
    ), 0),
    'usdc_balance', COALESCE((
      SELECT balance::numeric / 1000000 FROM public.wallets
      WHERE user_id = '00000000-0000-4000-8000-000000000001' AND currency = 'USDC'
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
  p_usdc_micro bigint
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

  IF p_usdc_micro <= 0 THEN
    RAISE EXCEPTION 'Amount must be positive';
  END IF;

  SELECT * INTO v_settings FROM public.platform_settings WHERE id = 1;
  IF NOT v_settings.fx_enabled THEN
    RAISE EXCEPTION 'FX conversion is currently disabled';
  END IF;

  IF p_usdc_micro < v_settings.fx_min_trade_usdc_micro THEN
    RAISE EXCEPTION 'Minimum trade is % USDC', v_settings.fx_min_trade_usdc_micro::numeric / 1000000;
  END IF;

  v_market_kobo := v_settings.fx_market_rate_kobo;
  IF v_market_kobo IS NULL OR v_market_kobo <= 0 THEN
    RAISE EXCEPTION 'Market rate unavailable. Try again shortly.';
  END IF;

  v_daily := public.fx_user_daily_volume_usdc_micro(p_user_id);
  IF v_daily + p_usdc_micro > v_settings.fx_daily_cap_usdc_micro THEN
    RAISE EXCEPTION 'Daily conversion limit exceeded';
  END IF;

  IF p_side = 'sell' THEN
    v_effective_kobo := public.fx_compute_sell_rate_kobo(
      v_market_kobo, v_settings.fx_sell_flat_kobo, v_settings.fx_sell_percent
    );
    v_ngn_gross := FLOOR(p_usdc_micro::numeric * v_effective_kobo / 1000000)::BIGINT;
    v_fee_percent := v_settings.fx_sell_platform_fee_percent;
    v_fee_kobo := FLOOR(v_ngn_gross::numeric * v_fee_percent / 100)::BIGINT;
    v_ngn_net := v_ngn_gross - v_fee_kobo;
  ELSE
    v_effective_kobo := public.fx_compute_buy_rate_kobo(
      v_market_kobo, v_settings.fx_buy_flat_kobo, v_settings.fx_buy_percent
    );
    v_ngn_gross := CEIL(p_usdc_micro::numeric * v_effective_kobo / 1000000)::BIGINT;
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
    user_id, side, usdc_micro, ngn_gross_kobo, fee_kobo, ngn_net_kobo,
    market_rate_kobo, effective_rate_kobo, expires_at
  ) VALUES (
    p_user_id, p_side, p_usdc_micro, v_ngn_gross, v_fee_kobo, v_ngn_net,
    v_market_kobo, v_effective_kobo, v_expires
  )
  RETURNING id INTO v_quote_id;

  RETURN jsonb_build_object(
    'quote_id', v_quote_id,
    'side', p_side,
    'usdc_micro', p_usdc_micro,
    'usdc', p_usdc_micro::numeric / 1000000,
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
  v_user_usdc_wallet uuid;
  v_treasury_ngn uuid;
  v_treasury_usdc uuid;
  v_treasury_user uuid := '00000000-0000-4000-8000-000000000001';
  v_swap_txn_id uuid;
  v_idem text;
  v_treasury_ngn_bal bigint;
  v_treasury_usdc_bal bigint;
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
  SELECT id INTO v_user_usdc_wallet FROM public.wallets WHERE user_id = p_user_id AND currency = 'USDC';
  v_treasury_ngn := public.get_treasury_wallet_id('NGN');
  v_treasury_usdc := public.get_treasury_wallet_id('USDC');

  IF v_user_ngn_wallet IS NULL OR v_user_usdc_wallet IS NULL THEN
    RAISE EXCEPTION 'User wallets not found';
  END IF;

  IF v_treasury_ngn IS NULL OR v_treasury_usdc IS NULL THEN
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
      v_user_usdc_wallet, p_user_id, v_quote.usdc_micro, 0,
      'swap', 'Sold USDC for NGN', 'internal', v_idem || '-usdc-out',
      jsonb_build_object('quote_id', p_quote_id, 'side', 'sell')
    );

    PERFORM public.credit_wallet(
      v_treasury_usdc, v_treasury_user, v_quote.usdc_micro, 0,
      'swap', 'FX: received USDC from user', 'internal', NULL, v_idem || '-treasury-usdc-in',
      jsonb_build_object('quote_id', p_quote_id, 'side', 'sell')
    );

    PERFORM public.debit_wallet(
      v_treasury_ngn, v_treasury_user, v_quote.ngn_net_kobo, 0,
      'swap', 'FX: paid NGN to user', 'internal', v_idem || '-treasury-ngn-out',
      jsonb_build_object('quote_id', p_quote_id, 'side', 'sell')
    );

    v_swap_txn_id := public.credit_wallet(
      v_user_ngn_wallet, p_user_id, v_quote.ngn_net_kobo, 0,
      'swap', 'Received NGN from USDC sale', 'internal', NULL, v_idem || '-ngn-in',
      jsonb_build_object(
        'quote_id', p_quote_id,
        'side', 'sell',
        'usdc_micro', v_quote.usdc_micro,
        'ngn_gross_kobo', v_quote.ngn_gross_kobo,
        'fee_kobo', v_quote.fee_kobo,
        'market_rate_kobo', v_quote.market_rate_kobo,
        'effective_rate_kobo', v_quote.effective_rate_kobo
      )
    );
  ELSE
    SELECT balance INTO v_treasury_usdc_bal
    FROM public.wallets WHERE id = v_treasury_usdc FOR UPDATE;

    IF v_treasury_usdc_bal < v_quote.usdc_micro THEN
      RAISE EXCEPTION 'Insufficient USDC liquidity. Try a smaller amount or later.';
    END IF;

    PERFORM public.debit_wallet(
      v_user_ngn_wallet, p_user_id, v_quote.ngn_net_kobo, 0,
      'swap', 'Bought USDC with NGN', 'internal', v_idem || '-ngn-out',
      jsonb_build_object('quote_id', p_quote_id, 'side', 'buy')
    );

    PERFORM public.credit_wallet(
      v_treasury_ngn, v_treasury_user, v_quote.ngn_net_kobo, 0,
      'swap', 'FX: received NGN from user', 'internal', NULL, v_idem || '-treasury-ngn-in',
      jsonb_build_object('quote_id', p_quote_id, 'side', 'buy')
    );

    PERFORM public.debit_wallet(
      v_treasury_usdc, v_treasury_user, v_quote.usdc_micro, 0,
      'swap', 'FX: paid USDC to user', 'internal', v_idem || '-treasury-usdc-out',
      jsonb_build_object('quote_id', p_quote_id, 'side', 'buy')
    );

    v_swap_txn_id := public.credit_wallet(
      v_user_usdc_wallet, p_user_id, v_quote.usdc_micro, 0,
      'swap', 'Received USDC from NGN purchase', 'internal', NULL, v_idem || '-usdc-in',
      jsonb_build_object(
        'quote_id', p_quote_id,
        'side', 'buy',
        'usdc_micro', v_quote.usdc_micro,
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
GRANT EXECUTE ON FUNCTION public.fx_user_daily_volume_usdc_micro(uuid) TO service_role;
