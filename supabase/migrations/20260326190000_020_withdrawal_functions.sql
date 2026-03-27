-- Migration 020: Withdrawal helper functions
-- ================================================
-- Lock funds during pending withdrawal, complete or release on callback.

CREATE OR REPLACE FUNCTION public.lock_withdrawal(
  p_wallet_id UUID,
  p_user_id UUID,
  p_amount BIGINT,
  p_fee BIGINT DEFAULT 0,
  p_type transaction_type DEFAULT 'withdrawal',
  p_description TEXT DEFAULT 'Withdrawal',
  p_provider VARCHAR(20) DEFAULT 'monnify',
  p_provider_ref VARCHAR(255) DEFAULT NULL,
  p_idempotency_key VARCHAR(255) DEFAULT NULL,
  p_metadata JSONB DEFAULT NULL
)
RETURNS UUID AS $$
DECLARE
  v_txn_id UUID;
  v_balance BIGINT;
  v_locked BIGINT;
  v_available BIGINT;
  v_total BIGINT;
  v_currency currency;
BEGIN
  IF p_idempotency_key IS NULL THEN
    p_idempotency_key := 'wd-' || gen_random_uuid()::text;
  END IF;

  SELECT id INTO v_txn_id FROM public.transactions WHERE idempotency_key = p_idempotency_key;
  IF v_txn_id IS NOT NULL THEN RETURN v_txn_id; END IF;

  v_total := p_amount + p_fee;

  SELECT balance, locked_balance, currency
  INTO v_balance, v_locked, v_currency
  FROM public.wallets WHERE id = p_wallet_id FOR UPDATE;

  IF NOT FOUND THEN RAISE EXCEPTION 'Wallet not found: %', p_wallet_id; END IF;

  v_available := v_balance - v_locked;
  IF v_available < v_total THEN
    RAISE EXCEPTION 'Insufficient available balance. Available: %, Required: %', v_available, v_total;
  END IF;

  UPDATE public.wallets
  SET locked_balance = locked_balance + v_total, updated_at = now()
  WHERE id = p_wallet_id;

  INSERT INTO public.transactions (
    wallet_id, user_id, currency, type, amount, fee, net_amount,
    status, provider, provider_ref, idempotency_key, description, metadata
  ) VALUES (
    p_wallet_id, p_user_id, v_currency, p_type, -p_amount, p_fee, -(v_total),
    'pending', p_provider, p_provider_ref, p_idempotency_key, p_description, p_metadata
  ) RETURNING id INTO v_txn_id;

  RETURN v_txn_id;
END;
$$ LANGUAGE plpgsql SECURITY DEFINER;

CREATE OR REPLACE FUNCTION public.complete_withdrawal(
  p_transaction_id UUID
)
RETURNS void AS $$
DECLARE
  v_wallet_id UUID;
  v_total BIGINT;
  v_balance_before BIGINT;
  v_status transaction_status;
BEGIN
  SELECT wallet_id, ABS(net_amount), status
  INTO v_wallet_id, v_total, v_status
  FROM public.transactions WHERE id = p_transaction_id FOR UPDATE;

  IF NOT FOUND THEN RAISE EXCEPTION 'Transaction not found: %', p_transaction_id; END IF;
  IF v_status != 'pending' THEN RETURN; END IF;

  SELECT balance INTO v_balance_before FROM public.wallets WHERE id = v_wallet_id FOR UPDATE;

  UPDATE public.wallets
  SET balance = balance - v_total,
      locked_balance = locked_balance - v_total,
      updated_at = now()
  WHERE id = v_wallet_id;

  UPDATE public.transactions
  SET status = 'completed', completed_at = now(), updated_at = now()
  WHERE id = p_transaction_id;

  INSERT INTO public.ledger_entries (transaction_id, wallet_id, entry_type, amount, balance_before, balance_after)
  VALUES (p_transaction_id, v_wallet_id, 'debit', v_total, v_balance_before, v_balance_before - v_total);
END;
$$ LANGUAGE plpgsql SECURITY DEFINER;

CREATE OR REPLACE FUNCTION public.fail_withdrawal(
  p_transaction_id UUID
)
RETURNS void AS $$
DECLARE
  v_wallet_id UUID;
  v_total BIGINT;
  v_status transaction_status;
BEGIN
  SELECT wallet_id, ABS(net_amount), status
  INTO v_wallet_id, v_total, v_status
  FROM public.transactions WHERE id = p_transaction_id FOR UPDATE;

  IF NOT FOUND THEN RAISE EXCEPTION 'Transaction not found: %', p_transaction_id; END IF;
  IF v_status != 'pending' THEN RETURN; END IF;

  UPDATE public.wallets
  SET locked_balance = locked_balance - v_total, updated_at = now()
  WHERE id = v_wallet_id;

  UPDATE public.transactions
  SET status = 'failed', updated_at = now()
  WHERE id = p_transaction_id;
END;
$$ LANGUAGE plpgsql SECURITY DEFINER;
