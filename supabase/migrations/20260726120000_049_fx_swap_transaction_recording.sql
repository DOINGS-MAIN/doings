-- Richer FX swap metadata on both user legs + consistent convert descriptions.

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
  v_meta jsonb;
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
  v_meta := jsonb_build_object(
    'quote_id', p_quote_id,
    'side', v_quote.side,
    'usdc_micro', v_quote.usdc_micro,
    'ngn_gross_kobo', v_quote.ngn_gross_kobo,
    'ngn_net_kobo', v_quote.ngn_net_kobo,
    'fee_kobo', v_quote.fee_kobo,
    'market_rate_kobo', v_quote.market_rate_kobo,
    'effective_rate_kobo', v_quote.effective_rate_kobo
  );

  IF v_quote.side = 'sell' THEN
    SELECT balance INTO v_treasury_ngn_bal
    FROM public.wallets WHERE id = v_treasury_ngn FOR UPDATE;

    IF v_treasury_ngn_bal < v_quote.ngn_net_kobo THEN
      RAISE EXCEPTION 'Insufficient conversion liquidity. Try a smaller amount or later.';
    END IF;

    PERFORM public.debit_wallet(
      v_user_usdc_wallet, p_user_id, v_quote.usdc_micro, 0,
      'swap', 'Convert · Sold USDC', 'internal', v_idem || '-usdc-out',
      v_meta
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
      'swap', 'Convert · Sold USDC', 'internal', NULL, v_idem || '-ngn-in',
      v_meta
    );
  ELSE
    SELECT balance INTO v_treasury_usdc_bal
    FROM public.wallets WHERE id = v_treasury_usdc FOR UPDATE;

    IF v_treasury_usdc_bal < v_quote.usdc_micro THEN
      RAISE EXCEPTION 'Insufficient USDC liquidity. Try a smaller amount or later.';
    END IF;

    PERFORM public.debit_wallet(
      v_user_ngn_wallet, p_user_id, v_quote.ngn_net_kobo, 0,
      'swap', 'Convert · Bought USDC', 'internal', v_idem || '-ngn-out',
      v_meta
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
      'swap', 'Convert · Bought USDC', 'internal', NULL, v_idem || '-usdc-in',
      v_meta
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

-- Backfill user-facing swap legs that were missing quote metadata.
UPDATE public.transactions out_txn
SET
  description = CASE
    WHEN out_txn.idempotency_key LIKE '%-ngn-out' THEN 'Convert · Bought USDC'
    WHEN out_txn.idempotency_key LIKE '%-usdc-out' THEN 'Convert · Sold USDC'
    WHEN out_txn.idempotency_key LIKE '%-ngn-in' THEN 'Convert · Sold USDC'
    WHEN out_txn.idempotency_key LIKE '%-usdc-in' THEN 'Convert · Bought USDC'
    ELSE out_txn.description
  END,
  metadata = COALESCE(in_txn.metadata, out_txn.metadata)
FROM public.transactions in_txn
WHERE out_txn.type = 'swap'
  AND out_txn.idempotency_key LIKE 'fx-swap-%-ngn-out'
  AND in_txn.idempotency_key = replace(out_txn.idempotency_key, '-ngn-out', '-usdc-in')
  AND (out_txn.metadata IS NULL OR out_txn.metadata = '{}'::jsonb OR NOT (out_txn.metadata ? 'usdc_micro'));

UPDATE public.transactions out_txn
SET
  description = CASE
    WHEN out_txn.idempotency_key LIKE '%-usdc-out' THEN 'Convert · Sold USDC'
    WHEN out_txn.idempotency_key LIKE '%-ngn-in' THEN 'Convert · Sold USDC'
    ELSE out_txn.description
  END,
  metadata = COALESCE(in_txn.metadata, out_txn.metadata)
FROM public.transactions in_txn
WHERE out_txn.type = 'swap'
  AND out_txn.idempotency_key LIKE 'fx-swap-%-usdc-out'
  AND in_txn.idempotency_key = replace(out_txn.idempotency_key, '-usdc-out', '-ngn-in')
  AND (out_txn.metadata IS NULL OR out_txn.metadata = '{}'::jsonb OR NOT (out_txn.metadata ? 'usdc_micro'));
