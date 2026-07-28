-- Fix settle_spray_hold: release wallet lock before debit_wallet.
-- When hold == full available balance, debit ran while locked left available=0 and settlement failed.

CREATE OR REPLACE FUNCTION public.settle_spray_hold(
  p_hold_id UUID,
  p_sprayer_id UUID,
  p_settlement public.spray_settlement_type,
  p_sprayed_amount_kobo BIGINT DEFAULT 0
)
RETURNS UUID
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_hold RECORD;
  v_event RECORD;
  v_receiver_wallet UUID;
  v_transfer_id UUID;
  v_sender_txn_id UUID;
  v_receiver_txn_id UUID;
  v_idem_key TEXT;
  v_charged BIGINT;
  v_note_count INT;
  v_metadata JSONB;
BEGIN
  SELECT * INTO v_hold
  FROM public.spray_holds
  WHERE id = p_hold_id
  FOR UPDATE;

  IF NOT FOUND THEN
    RAISE EXCEPTION 'Spray hold not found';
  END IF;

  IF v_hold.sprayer_id <> p_sprayer_id THEN
    RAISE EXCEPTION 'Not authorized for this spray hold';
  END IF;

  IF v_hold.status <> 'pending' THEN
    RAISE EXCEPTION 'Spray hold is not pending';
  END IF;

  PERFORM 1 FROM public.wallets WHERE id = v_hold.wallet_id FOR UPDATE;

  IF p_settlement = 'cancelled' THEN
    IF p_sprayed_amount_kobo <> 0 THEN
      RAISE EXCEPTION 'Cancelled settlement requires zero sprayed amount';
    END IF;

    UPDATE public.wallets
    SET locked_balance = locked_balance - v_hold.planned_amount_kobo,
        updated_at = now()
    WHERE id = v_hold.wallet_id;

    UPDATE public.spray_holds
    SET status = 'released',
        settlement_type = 'cancelled',
        charged_amount_kobo = 0,
        settled_at = now()
    WHERE id = p_hold_id;

    RETURN NULL;
  END IF;

  IF p_settlement = 'full' THEN
    v_charged := v_hold.planned_amount_kobo;
    v_note_count := v_hold.note_count;
  ELSIF p_settlement = 'partial' THEN
    IF p_sprayed_amount_kobo <= 0 OR p_sprayed_amount_kobo >= v_hold.planned_amount_kobo THEN
      RAISE EXCEPTION 'Partial settlement requires sprayed amount between 0 and planned amount';
    END IF;

    IF p_sprayed_amount_kobo % (v_hold.denomination * 100) <> 0 THEN
      RAISE EXCEPTION 'Sprayed amount must be divisible by denomination';
    END IF;

    v_charged := p_sprayed_amount_kobo;
    v_note_count := p_sprayed_amount_kobo / (v_hold.denomination * 100);
  ELSE
    RAISE EXCEPTION 'Invalid settlement type';
  END IF;

  SELECT id, host_id, status INTO v_event
  FROM public.events
  WHERE id = v_hold.event_id
  FOR UPDATE;

  IF NOT FOUND THEN
    RAISE EXCEPTION 'Event not found';
  END IF;

  IF v_event.status <> 'live' THEN
    RAISE EXCEPTION 'Event is not live';
  END IF;

  SELECT id INTO v_receiver_wallet
  FROM public.wallets
  WHERE user_id = v_event.host_id AND currency = 'NGN';

  IF v_receiver_wallet IS NULL THEN
    RAISE EXCEPTION 'Receiver wallet not found';
  END IF;

  -- Release hold before debit so available balance includes reserved funds.
  UPDATE public.wallets
  SET locked_balance = locked_balance - v_hold.planned_amount_kobo,
      updated_at = now()
  WHERE id = v_hold.wallet_id;

  v_idem_key := 'spray-hold-' || p_hold_id::text;

  v_metadata := v_hold.metadata || jsonb_build_object(
    'hold_id', p_hold_id,
    'settlement', p_settlement::text,
    'planned_amount_kobo', v_hold.planned_amount_kobo,
    'charged_amount_kobo', v_charged
  );

  v_sender_txn_id := public.debit_wallet(
    v_hold.wallet_id,
    p_sprayer_id,
    v_charged,
    0,
    'spray',
    'Spray at event ' || v_hold.event_id::text || ' (sent)',
    'internal',
    v_idem_key || '-send',
    v_metadata
  );

  v_receiver_txn_id := public.credit_wallet(
    v_receiver_wallet,
    v_event.host_id,
    v_charged,
    0,
    'receive',
    'Spray at event ' || v_hold.event_id::text || ' (received)',
    'internal',
    NULL,
    v_idem_key || '-recv',
    v_metadata
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
    v_hold.wallet_id,
    v_receiver_wallet,
    p_sprayer_id,
    v_event.host_id,
    w.currency,
    v_charged,
    0,
    'completed',
    v_sender_txn_id,
    v_receiver_txn_id,
    'Spray at event ' || v_hold.event_id::text
  FROM public.wallets w
  WHERE w.id = v_hold.wallet_id
  RETURNING id INTO v_transfer_id;

  INSERT INTO public.spray_records (
    event_id,
    sprayer_id,
    receiver_id,
    transaction_id,
    amount,
    denomination,
    note_count,
    metadata
  ) VALUES (
    v_hold.event_id,
    p_sprayer_id,
    v_event.host_id,
    v_sender_txn_id,
    v_charged,
    v_hold.denomination,
    v_note_count,
    COALESCE(v_metadata, '{}'::jsonb)
  );

  UPDATE public.spray_holds
  SET status = 'settled',
      settlement_type = p_settlement,
      charged_amount_kobo = v_charged,
      transfer_id = v_transfer_id,
      settled_at = now()
  WHERE id = p_hold_id;

  RETURN v_transfer_id;
END;
$$;
