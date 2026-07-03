-- Migration 032: Withdrawal processing state + reconcile index
-- =============================================================

-- Allow complete/fail on in-flight withdrawals (pending or processing).
CREATE OR REPLACE FUNCTION public.complete_withdrawal(
  p_transaction_id UUID
)
RETURNS void AS $$
DECLARE
  v_wallet_id UUID;
  v_total BIGINT;
  v_status transaction_status;
  v_balance_before BIGINT;
BEGIN
  SELECT wallet_id, ABS(net_amount), status
  INTO v_wallet_id, v_total, v_status
  FROM public.transactions WHERE id = p_transaction_id FOR UPDATE;

  IF NOT FOUND THEN RAISE EXCEPTION 'Transaction not found: %', p_transaction_id; END IF;
  IF v_status NOT IN ('pending', 'processing') THEN RETURN; END IF;

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
  IF v_status NOT IN ('pending', 'processing') THEN RETURN; END IF;

  UPDATE public.wallets
  SET locked_balance = locked_balance - v_total, updated_at = now()
  WHERE id = v_wallet_id;

  UPDATE public.transactions
  SET status = 'failed', updated_at = now()
  WHERE id = p_transaction_id;
END;
$$ LANGUAGE plpgsql SECURITY DEFINER;

CREATE INDEX IF NOT EXISTS idx_txn_withdrawal_reconcile
  ON public.transactions(created_at)
  WHERE type = 'withdrawal' AND status IN ('pending', 'processing');
