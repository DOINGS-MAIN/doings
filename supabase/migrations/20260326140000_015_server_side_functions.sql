-- Migration 015: Server-Side Functions & Stored Procedures
-- ================================================

CREATE OR REPLACE FUNCTION public.credit_wallet(
  p_wallet_id UUID,
  p_user_id UUID,
  p_amount BIGINT,
  p_fee BIGINT DEFAULT 0,
  p_type transaction_type DEFAULT 'deposit',
  p_description TEXT DEFAULT '',
  p_provider VARCHAR(20) DEFAULT 'internal',
  p_provider_ref VARCHAR(255) DEFAULT NULL,
  p_idempotency_key VARCHAR(255) DEFAULT NULL,
  p_metadata JSONB DEFAULT NULL
)
RETURNS UUID AS $$
DECLARE
  v_txn_id UUID;
  v_balance_before BIGINT;
  v_net_amount BIGINT;
  v_wallet_currency currency;
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

  v_net_amount := p_amount - p_fee;

  SELECT balance, currency INTO v_balance_before, v_wallet_currency
  FROM public.wallets
  WHERE id = p_wallet_id
  FOR UPDATE;

  IF NOT FOUND THEN
    RAISE EXCEPTION 'Wallet not found: %', p_wallet_id;
  END IF;

  UPDATE public.wallets
  SET balance = balance + v_net_amount,
      updated_at = now()
  WHERE id = p_wallet_id;

  INSERT INTO public.transactions (
    wallet_id, user_id, currency, type, amount, fee,
    net_amount, status, provider, provider_ref,
    idempotency_key, description, metadata, completed_at
  ) VALUES (
    p_wallet_id, p_user_id, v_wallet_currency, p_type, p_amount, p_fee,
    v_net_amount, 'completed', p_provider, p_provider_ref,
    p_idempotency_key, p_description, p_metadata, now()
  )
  RETURNING id INTO v_txn_id;

  INSERT INTO public.ledger_entries (
    transaction_id, wallet_id, entry_type, amount, balance_before, balance_after
  ) VALUES (
    v_txn_id, p_wallet_id, 'credit', v_net_amount, v_balance_before, v_balance_before + v_net_amount
  );

  RETURN v_txn_id;
END;
$$ LANGUAGE plpgsql SECURITY DEFINER;

CREATE OR REPLACE FUNCTION public.debit_wallet(
  p_wallet_id UUID,
  p_user_id UUID,
  p_amount BIGINT,
  p_fee BIGINT DEFAULT 0,
  p_type transaction_type DEFAULT 'send',
  p_description TEXT DEFAULT '',
  p_provider VARCHAR(20) DEFAULT 'internal',
  p_idempotency_key VARCHAR(255) DEFAULT NULL,
  p_metadata JSONB DEFAULT NULL
)
RETURNS UUID AS $$
DECLARE
  v_txn_id UUID;
  v_balance_before BIGINT;
  v_locked_balance BIGINT;
  v_available BIGINT;
  v_total_debit BIGINT;
  v_wallet_currency currency;
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
$$ LANGUAGE plpgsql SECURITY DEFINER;

CREATE OR REPLACE FUNCTION public.internal_transfer(
  p_sender_wallet_id UUID,
  p_receiver_wallet_id UUID,
  p_sender_user_id UUID,
  p_receiver_user_id UUID,
  p_amount BIGINT,
  p_fee BIGINT DEFAULT 0,
  p_description TEXT DEFAULT 'Internal transfer',
  p_type transaction_type DEFAULT 'send'
)
RETURNS UUID AS $$
DECLARE
  v_transfer_id UUID;
  v_sender_txn_id UUID;
  v_receiver_txn_id UUID;
  v_idem_key TEXT;
BEGIN
  v_idem_key := 'xfer-' || gen_random_uuid()::text;

  v_sender_txn_id := public.debit_wallet(
    p_sender_wallet_id, p_sender_user_id, p_amount, p_fee,
    p_type, p_description || ' (sent)', 'internal', v_idem_key || '-send'
  );

  v_receiver_txn_id := public.credit_wallet(
    p_receiver_wallet_id, p_receiver_user_id, p_amount, 0,
    'receive', p_description || ' (received)', 'internal', NULL, v_idem_key || '-recv'
  );

  INSERT INTO public.transfers (
    sender_wallet_id, receiver_wallet_id,
    sender_user_id, receiver_user_id,
    currency, amount, fee, status,
    sender_transaction_id, receiver_transaction_id, description
  )
  SELECT
    p_sender_wallet_id, p_receiver_wallet_id,
    p_sender_user_id, p_receiver_user_id,
    w.currency, p_amount, p_fee, 'completed',
    v_sender_txn_id, v_receiver_txn_id, p_description
  FROM public.wallets w
  WHERE w.id = p_sender_wallet_id
  RETURNING id INTO v_transfer_id;

  RETURN v_transfer_id;
END;
$$ LANGUAGE plpgsql SECURITY DEFINER;

CREATE OR REPLACE FUNCTION public.reconcile_wallets()
RETURNS TABLE(
  wallet_id UUID,
  wallet_balance BIGINT,
  ledger_balance BIGINT,
  discrepancy BIGINT
) AS $$
BEGIN
  RETURN QUERY
  SELECT
    w.id AS wallet_id,
    w.balance AS wallet_balance,
    COALESCE(
      SUM(CASE
        WHEN le.entry_type = 'credit' THEN le.amount
        WHEN le.entry_type = 'debit' THEN -le.amount
        ELSE 0
      END),
      0
    )::BIGINT AS ledger_balance,
    (w.balance - COALESCE(
      SUM(CASE
        WHEN le.entry_type = 'credit' THEN le.amount
        WHEN le.entry_type = 'debit' THEN -le.amount
        ELSE 0
      END),
      0
    ))::BIGINT AS discrepancy
  FROM public.wallets w
  LEFT JOIN public.ledger_entries le ON le.wallet_id = w.id
  GROUP BY w.id, w.balance
  HAVING w.balance != COALESCE(
    SUM(CASE
      WHEN le.entry_type = 'credit' THEN le.amount
      WHEN le.entry_type = 'debit' THEN -le.amount
      ELSE 0
    END),
    0
  )::BIGINT;
END;
$$ LANGUAGE plpgsql SECURITY DEFINER;
