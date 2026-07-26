-- Atomically transfer NGN for a spray and insert spray_records with transaction_id linked.

CREATE OR REPLACE FUNCTION public.record_event_spray(
  p_event_id UUID,
  p_sprayer_id UUID,
  p_amount_kobo BIGINT,
  p_denomination INT,
  p_note_count INT
)
RETURNS UUID
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_event RECORD;
  v_sender_wallet UUID;
  v_receiver_wallet UUID;
  v_transfer_id UUID;
  v_sender_txn_id UUID;
  v_receiver_txn_id UUID;
  v_idem_key TEXT;
BEGIN
  IF p_amount_kobo <= 0 THEN
    RAISE EXCEPTION 'Spray amount must be positive';
  END IF;

  IF p_denomination NOT IN (200, 500, 1000) THEN
    RAISE EXCEPTION 'Invalid denomination';
  END IF;

  IF p_note_count <= 0 OR p_amount_kobo <> p_denomination * 100 * p_note_count THEN
    RAISE EXCEPTION 'amount must be divisible by denomination';
  END IF;

  SELECT id, host_id, status INTO v_event
  FROM public.events
  WHERE id = p_event_id
  FOR UPDATE;

  IF NOT FOUND THEN
    RAISE EXCEPTION 'Event not found';
  END IF;

  IF v_event.status <> 'live' THEN
    RAISE EXCEPTION 'Event is not live';
  END IF;

  IF v_event.host_id = p_sprayer_id THEN
    RAISE EXCEPTION 'Host cannot spray own event';
  END IF;

  SELECT id INTO v_sender_wallet
  FROM public.wallets
  WHERE user_id = p_sprayer_id AND currency = 'NGN';

  SELECT id INTO v_receiver_wallet
  FROM public.wallets
  WHERE user_id = v_event.host_id AND currency = 'NGN';

  IF v_sender_wallet IS NULL OR v_receiver_wallet IS NULL THEN
    RAISE EXCEPTION 'Wallet not found';
  END IF;

  v_idem_key := 'spray-' || gen_random_uuid()::text;

  v_sender_txn_id := public.debit_wallet(
    v_sender_wallet,
    p_sprayer_id,
    p_amount_kobo,
    0,
    'spray',
    'Spray at event ' || p_event_id::text || ' (sent)',
    'internal',
    v_idem_key || '-send'
  );

  v_receiver_txn_id := public.credit_wallet(
    v_receiver_wallet,
    v_event.host_id,
    p_amount_kobo,
    0,
    'receive',
    'Spray at event ' || p_event_id::text || ' (received)',
    'internal',
    NULL,
    v_idem_key || '-recv'
  );

  INSERT INTO public.transfers (
    sender_wallet_id,
    receiver_wallet_id,
    sender_user_id,
    receiver_user_id,
    currency,
    amount,
    fee,
    status,
    sender_transaction_id,
    receiver_transaction_id,
    description
  )
  SELECT
    v_sender_wallet,
    v_receiver_wallet,
    p_sprayer_id,
    v_event.host_id,
    w.currency,
    p_amount_kobo,
    0,
    'completed',
    v_sender_txn_id,
    v_receiver_txn_id,
    'Spray at event ' || p_event_id::text
  FROM public.wallets w
  WHERE w.id = v_sender_wallet
  RETURNING id INTO v_transfer_id;

  INSERT INTO public.spray_records (
    event_id,
    sprayer_id,
    receiver_id,
    transaction_id,
    amount,
    denomination,
    note_count
  ) VALUES (
    p_event_id,
    p_sprayer_id,
    v_event.host_id,
    v_sender_txn_id,
    p_amount_kobo,
    p_denomination,
    p_note_count
  );

  RETURN v_transfer_id;
END;
$$;

GRANT EXECUTE ON FUNCTION public.record_event_spray(UUID, UUID, BIGINT, INT, INT) TO service_role;
