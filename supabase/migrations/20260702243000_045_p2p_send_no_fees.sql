-- In-app user-to-user sends are always fee-free (no platform or transaction fee).

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
  v_fee BIGINT;
BEGIN
  IF p_amount <= 0 THEN
    RAISE EXCEPTION 'Transfer amount must be positive';
  END IF;

  -- P2P sends never incur platform or transaction fees.
  v_fee := CASE WHEN p_type = 'send' THEN 0 ELSE COALESCE(p_fee, 0) END;

  v_idem_key := 'xfer-' || gen_random_uuid()::text;

  v_sender_txn_id := public.debit_wallet(
    p_sender_wallet_id, p_sender_user_id, p_amount, v_fee,
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
    w.currency, p_amount, v_fee, 'completed',
    v_sender_txn_id, v_receiver_txn_id, p_description
  FROM public.wallets w
  WHERE w.id = p_sender_wallet_id
  RETURNING id INTO v_transfer_id;

  RETURN v_transfer_id;
END;
$$ LANGUAGE plpgsql SECURITY DEFINER;
