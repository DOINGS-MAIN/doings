-- Phase 1: spray theatre admin settings, plan metadata on spray_records.

ALTER TABLE public.platform_settings
  ADD COLUMN IF NOT EXISTS spray_stage_min_per_100k_denom_200 NUMERIC(8, 2) NOT NULL DEFAULT 3,
  ADD COLUMN IF NOT EXISTS spray_stage_min_per_100k_denom_500 NUMERIC(8, 2) NOT NULL DEFAULT 2.5,
  ADD COLUMN IF NOT EXISTS spray_stage_min_per_100k_denom_1000 NUMERIC(8, 2) NOT NULL DEFAULT 2,
  ADD COLUMN IF NOT EXISTS spray_stage_min_per_100_usdc NUMERIC(8, 2) NOT NULL DEFAULT 4,
  ADD COLUMN IF NOT EXISTS spray_max_single_ngn_kobo BIGINT NOT NULL DEFAULT 100000000,
  ADD COLUMN IF NOT EXISTS spray_guest_session_cap_sec INT NOT NULL DEFAULT 180,
  ADD COLUMN IF NOT EXISTS spray_max_stage_sec INT NOT NULL DEFAULT 2700,
  ADD COLUMN IF NOT EXISTS spray_queue_compression_tiers JSONB NOT NULL DEFAULT '[
    {"min_queue": 0, "multiplier": 1},
    {"min_queue": 10, "multiplier": 0.85},
    {"min_queue": 50, "multiplier": 0.55},
    {"min_queue": 100, "multiplier": 0.35}
  ]'::jsonb;

ALTER TABLE public.spray_records
  ADD COLUMN IF NOT EXISTS metadata JSONB NOT NULL DEFAULT '{}'::jsonb;

COMMENT ON COLUMN public.platform_settings.spray_stage_min_per_100k_denom_200 IS
  'Projector stage minutes per ₦100,000 sprayed as ₦200 notes (before queue compression).';
COMMENT ON COLUMN public.spray_records.metadata IS
  'Spray theatre plan snapshot (base_stage_sec, session_duration_sec, etc.) at record time.';

CREATE OR REPLACE FUNCTION public.get_spray_theatre_admin_settings()
RETURNS jsonb
LANGUAGE plpgsql
STABLE
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  _admin_id uuid := auth.uid();
BEGIN
  IF NOT (
    public.has_admin_role(_admin_id, 'super_admin')
    OR public.has_admin_role(_admin_id, 'finance')
    OR public.has_admin_role(_admin_id, 'support')
  ) THEN
    RAISE EXCEPTION 'Not authorized';
  END IF;

  RETURN (
    SELECT jsonb_build_object(
      'stage_min_per_100k_denom_200', spray_stage_min_per_100k_denom_200,
      'stage_min_per_100k_denom_500', spray_stage_min_per_100k_denom_500,
      'stage_min_per_100k_denom_1000', spray_stage_min_per_100k_denom_1000,
      'stage_min_per_100_usdc', spray_stage_min_per_100_usdc,
      'max_single_spray_ngn', spray_max_single_ngn_kobo::numeric / 100,
      'guest_session_cap_sec', spray_guest_session_cap_sec,
      'max_stage_sec', spray_max_stage_sec,
      'queue_compression_tiers', spray_queue_compression_tiers
    )
    FROM public.platform_settings
    WHERE id = 1
  );
END;
$$;

CREATE OR REPLACE FUNCTION public.set_spray_theatre_settings(
  p_stage_min_per_100k_denom_200 numeric,
  p_stage_min_per_100k_denom_500 numeric,
  p_stage_min_per_100k_denom_1000 numeric,
  p_stage_min_per_100_usdc numeric,
  p_max_single_spray_ngn_kobo bigint,
  p_guest_session_cap_sec int,
  p_max_stage_sec int,
  p_queue_compression_tiers jsonb
)
RETURNS void
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  _admin_id uuid := auth.uid();
BEGIN
  IF NOT (
    public.has_admin_role(_admin_id, 'super_admin')
    OR public.has_admin_role(_admin_id, 'finance')
  ) THEN
    RAISE EXCEPTION 'Only finance or super admins can update spray theatre settings';
  END IF;

  IF p_stage_min_per_100k_denom_200 <= 0
    OR p_stage_min_per_100k_denom_500 <= 0
    OR p_stage_min_per_100k_denom_1000 <= 0
    OR p_stage_min_per_100_usdc <= 0 THEN
    RAISE EXCEPTION 'Stage benchmark minutes must be positive';
  END IF;

  IF p_max_single_spray_ngn_kobo <= 0 OR p_guest_session_cap_sec <= 0 OR p_max_stage_sec <= 0 THEN
    RAISE EXCEPTION 'Limits must be positive';
  END IF;

  UPDATE public.platform_settings
  SET
    spray_stage_min_per_100k_denom_200 = p_stage_min_per_100k_denom_200,
    spray_stage_min_per_100k_denom_500 = p_stage_min_per_100k_denom_500,
    spray_stage_min_per_100k_denom_1000 = p_stage_min_per_100k_denom_1000,
    spray_stage_min_per_100_usdc = p_stage_min_per_100_usdc,
    spray_max_single_ngn_kobo = p_max_single_spray_ngn_kobo,
    spray_guest_session_cap_sec = p_guest_session_cap_sec,
    spray_max_stage_sec = p_max_stage_sec,
    spray_queue_compression_tiers = p_queue_compression_tiers,
    updated_at = now(),
    updated_by = _admin_id
  WHERE id = 1;

  PERFORM public.log_admin_action(
    _admin_id,
    'set_spray_theatre_settings',
    'platform_settings',
    NULL,
    jsonb_build_object(
      'stage_min_per_100k_denom_200', p_stage_min_per_100k_denom_200,
      'max_single_spray_ngn_kobo', p_max_single_spray_ngn_kobo
    )
  );
END;
$$;

GRANT EXECUTE ON FUNCTION public.get_spray_theatre_admin_settings() TO authenticated;
GRANT EXECUTE ON FUNCTION public.set_spray_theatre_settings(numeric, numeric, numeric, numeric, bigint, int, int, jsonb) TO authenticated;

DROP FUNCTION IF EXISTS public.record_event_spray(UUID, UUID, BIGINT, INT, INT);

CREATE OR REPLACE FUNCTION public.record_event_spray(
  p_event_id UUID,
  p_sprayer_id UUID,
  p_amount_kobo BIGINT,
  p_denomination INT,
  p_note_count INT,
  p_metadata JSONB DEFAULT '{}'::jsonb
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
    note_count,
    metadata
  ) VALUES (
    p_event_id,
    p_sprayer_id,
    v_event.host_id,
    v_sender_txn_id,
    p_amount_kobo,
    p_denomination,
    p_note_count,
    COALESCE(p_metadata, '{}'::jsonb)
  );

  RETURN v_transfer_id;
END;
$$;

GRANT EXECUTE ON FUNCTION public.record_event_spray(UUID, UUID, BIGINT, INT, INT, JSONB) TO service_role;
