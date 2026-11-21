-- 116: sharing with only a verified email actually goes through when the admin switch is off.
-- 113 moved the "does sharing need BVN?" decision to an admin switch (share_requires_identity) and
-- the transfer function follows it, but debit_wallet still refused every 'send' below level 2. So
-- with the switch off, an email-only account passed every check and then failed at the debit with
-- a server error (go-live test B4, 2026-11-21). The debit now follows the same switch (owner
-- confirmed 2026-11-21: off = not required, on = required). Only this rule changes; the rest of
-- the function is as it was. Grants are unchanged (CREATE OR REPLACE keeps them).

CREATE OR REPLACE FUNCTION public.debit_wallet(p_wallet_id uuid, p_user_id uuid, p_amount bigint, p_fee bigint DEFAULT 0, p_type transaction_type DEFAULT 'send'::transaction_type, p_description text DEFAULT ''::text, p_provider character varying DEFAULT 'internal'::character varying, p_idempotency_key character varying DEFAULT NULL::character varying, p_metadata jsonb DEFAULT NULL::jsonb)
 RETURNS uuid
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public', 'extensions'
AS $function$
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

  -- Spraying, giveaways and bundle purchases (USDC -> bundles, server-only) need a verified email
  -- (level 1). Sharing ('send') follows the admin switch from 113: a verified email when
  -- share_requires_identity is off, BVN + selfie when it is on; if the switch cannot be read it is
  -- treated as on. Every other debit (payouts, conversions) still needs level 2.
  IF p_type IN ('spray', 'giveaway', 'purchase') THEN
    v_required_kyc := 1;
  ELSIF p_type = 'send' THEN
    SELECT CASE WHEN share_requires_identity THEN 2 ELSE 1 END INTO v_required_kyc
    FROM public.platform_settings WHERE id = 1;
    v_required_kyc := COALESCE(v_required_kyc, 2);
  ELSE
    v_required_kyc := 2;
  END IF;
  IF v_total_debit > 0 AND v_kyc < v_required_kyc THEN
    IF v_required_kyc = 1 THEN
      RAISE EXCEPTION 'Verify your email to spray, share, create giveaways or buy bundles';
    END IF;
    RAISE EXCEPTION 'Complete identity verification (BVN + selfie) to send or spend funds';
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
$function$;
