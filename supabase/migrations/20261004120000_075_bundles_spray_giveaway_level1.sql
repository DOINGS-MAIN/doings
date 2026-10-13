-- Bundles phase 1: spray and giveaway debits need KYC level 1 (verified email); all other
-- debits keep level 2. This is the live debit_wallet definition (pg_get_functiondef,
-- 2026-10-04) with only the KYC check changed.

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

  -- Bundles model: spraying and giveaways need a verified email (level 1); every other debit
  -- (sell / cash-out, transfers, conversions) still needs BVN + NIN (level 2).
  IF p_type IN ('spray', 'giveaway') THEN
    v_required_kyc := 1;
  ELSE
    v_required_kyc := 2;
  END IF;
  IF v_total_debit > 0 AND v_kyc < v_required_kyc THEN
    IF v_required_kyc = 1 THEN
      RAISE EXCEPTION 'Verify your email to spray or create giveaways';
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
