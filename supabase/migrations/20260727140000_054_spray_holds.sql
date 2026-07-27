-- Phase 2: hold upfront at spray start; settle partial / full / cancel.

DO $$ BEGIN
  CREATE TYPE public.spray_hold_status AS ENUM ('pending', 'settled', 'released', 'expired');
EXCEPTION
  WHEN duplicate_object THEN NULL;
END $$;

DO $$ BEGIN
  CREATE TYPE public.spray_settlement_type AS ENUM ('partial', 'full', 'cancelled');
EXCEPTION
  WHEN duplicate_object THEN NULL;
END $$;

CREATE TABLE IF NOT EXISTS public.spray_holds (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  event_id UUID NOT NULL REFERENCES public.events(id),
  sprayer_id UUID NOT NULL REFERENCES public.users(id),
  wallet_id UUID NOT NULL REFERENCES public.wallets(id),
  planned_amount_kobo BIGINT NOT NULL CHECK (planned_amount_kobo > 0),
  denomination INT NOT NULL CHECK (denomination IN (200, 500, 1000)),
  note_count INT NOT NULL CHECK (note_count > 0),
  metadata JSONB NOT NULL DEFAULT '{}'::jsonb,
  status public.spray_hold_status NOT NULL DEFAULT 'pending',
  charged_amount_kobo BIGINT,
  settlement_type public.spray_settlement_type,
  transfer_id UUID,
  expires_at TIMESTAMPTZ NOT NULL,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  settled_at TIMESTAMPTZ,
  CONSTRAINT ck_spray_hold_planned_matches_denom
    CHECK (planned_amount_kobo = denomination * 100 * note_count)
);

CREATE INDEX IF NOT EXISTS idx_spray_holds_sprayer_status
  ON public.spray_holds(sprayer_id, status);
CREATE INDEX IF NOT EXISTS idx_spray_holds_event
  ON public.spray_holds(event_id);
CREATE INDEX IF NOT EXISTS idx_spray_holds_expires_pending
  ON public.spray_holds(expires_at)
  WHERE status = 'pending';

COMMENT ON TABLE public.spray_holds IS
  'Upfront wallet holds for spray sessions. Settle partial (stop early), full (auto-stop/complete), or cancelled (release).';

CREATE OR REPLACE FUNCTION public.create_spray_hold(
  p_event_id UUID,
  p_sprayer_id UUID,
  p_amount_kobo BIGINT,
  p_denomination INT,
  p_note_count INT,
  p_metadata JSONB DEFAULT '{}'::jsonb,
  p_expires_sec INT DEFAULT 600
)
RETURNS UUID
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_event RECORD;
  v_wallet RECORD;
  v_available BIGINT;
  v_hold_id UUID;
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

  SELECT id, balance, locked_balance INTO v_wallet
  FROM public.wallets
  WHERE user_id = p_sprayer_id AND currency = 'NGN'
  FOR UPDATE;

  IF NOT FOUND THEN
    RAISE EXCEPTION 'Wallet not found';
  END IF;

  v_available := v_wallet.balance - v_wallet.locked_balance;
  IF v_available < p_amount_kobo THEN
    RAISE EXCEPTION 'Insufficient balance';
  END IF;

  UPDATE public.wallets
  SET locked_balance = locked_balance + p_amount_kobo,
      updated_at = now()
  WHERE id = v_wallet.id;

  INSERT INTO public.spray_holds (
    event_id,
    sprayer_id,
    wallet_id,
    planned_amount_kobo,
    denomination,
    note_count,
    metadata,
    expires_at
  ) VALUES (
    p_event_id,
    p_sprayer_id,
    v_wallet.id,
    p_amount_kobo,
    p_denomination,
    p_note_count,
    COALESCE(p_metadata, '{}'::jsonb),
    now() + make_interval(secs => GREATEST(p_expires_sec, 60))
  )
  RETURNING id INTO v_hold_id;

  RETURN v_hold_id;
END;
$$;

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

  UPDATE public.wallets
  SET locked_balance = locked_balance - v_hold.planned_amount_kobo,
      updated_at = now()
  WHERE id = v_hold.wallet_id;

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
    v_metadata
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

CREATE OR REPLACE FUNCTION public.release_expired_spray_holds()
RETURNS INT
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_hold RECORD;
  v_count INT := 0;
BEGIN
  FOR v_hold IN
    SELECT id, wallet_id, planned_amount_kobo
    FROM public.spray_holds
    WHERE status = 'pending' AND expires_at <= now()
    FOR UPDATE SKIP LOCKED
  LOOP
    UPDATE public.wallets
    SET locked_balance = locked_balance - v_hold.planned_amount_kobo,
        updated_at = now()
    WHERE id = v_hold.wallet_id;

    UPDATE public.spray_holds
    SET status = 'expired',
        settlement_type = 'cancelled',
        charged_amount_kobo = 0,
        settled_at = now()
    WHERE id = v_hold.id;

    v_count := v_count + 1;
  END LOOP;

  RETURN v_count;
END;
$$;

GRANT EXECUTE ON FUNCTION public.create_spray_hold(UUID, UUID, BIGINT, INT, INT, JSONB, INT) TO service_role;
GRANT EXECUTE ON FUNCTION public.settle_spray_hold(UUID, UUID, public.spray_settlement_type, BIGINT) TO service_role;
GRANT EXECUTE ON FUNCTION public.release_expired_spray_holds() TO service_role;
