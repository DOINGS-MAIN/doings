-- 115: every amount limit is a setting an admin can change, and sprays get a daily allowance.
--
-- Until now some limits were settings with no way to change them from the admin (smallest purchase,
-- smallest sale, daily sale limit, largest spray), some were fixed in code (the smallest giveaway and
-- smallest share per person), and sprays had no daily limit at all, which left a way round the
-- sharing limit of 113: an email-only person could spray any amount to another person's event.
--
-- New settings (existing ones keep their values):
--   spray_daily_limit_l1_kobo      N1,000,000 a day, verified email only
--   spray_daily_limit_l2_kobo      N5,000,000 a day, BVN verified
--   giveaway_min_total_kobo        10,000 (100 bundles), as before
--   giveaway_min_per_person_kobo    1,000 (10 bundles), as before
--
-- A spray counts against today's allowance (UTC day, as for sharing) from the moment it is queued:
-- sprays already charged today, plus sprays waiting or on the floor that are not charged yet.
-- A spray that is released or expires without being charged gives its allowance back.
--
-- BEFORE APPLYING: queue_floor_spray, create_spray_hold and record_event_spray are re-created from
--   the live definitions with one added line each, and create_giveaway_funded from 113; diff each
--   against pg_get_functiondef on the live function. Needs 113 and 114.

ALTER TABLE public.platform_settings
  ADD COLUMN IF NOT EXISTS spray_daily_limit_l1_kobo BIGINT NOT NULL DEFAULT 100000000 CHECK (spray_daily_limit_l1_kobo >= 0),
  ADD COLUMN IF NOT EXISTS spray_daily_limit_l2_kobo BIGINT NOT NULL DEFAULT 500000000 CHECK (spray_daily_limit_l2_kobo >= 0),
  ADD COLUMN IF NOT EXISTS giveaway_min_total_kobo BIGINT NOT NULL DEFAULT 10000 CHECK (giveaway_min_total_kobo >= 100),
  ADD COLUMN IF NOT EXISTS giveaway_min_per_person_kobo BIGINT NOT NULL DEFAULT 1000 CHECK (giveaway_min_per_person_kobo >= 100);

-- ── Sprays: one check, called by every function that starts a spray ──────────────────────────────
CREATE OR REPLACE FUNCTION public.spray_daily_check(p_sprayer_id uuid, p_amount_kobo bigint)
RETURNS void
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_limit bigint;
  v_day timestamptz := date_trunc('day', now() AT TIME ZONE 'UTC') AT TIME ZONE 'UTC';
  v_charged bigint;
  v_waiting bigint;
BEGIN
  -- The sprayer's wallet row is the lock: two sprays sent at the same moment are counted one after the other.
  PERFORM 1 FROM public.wallets WHERE user_id = p_sprayer_id AND currency = 'NGN' FOR UPDATE;

  SELECT CASE WHEN u.kyc_level >= 2 THEN s.spray_daily_limit_l2_kobo
              WHEN u.kyc_level = 1 THEN s.spray_daily_limit_l1_kobo
              ELSE 0 END
    INTO v_limit
    FROM public.users u CROSS JOIN public.platform_settings s
   WHERE u.id = p_sprayer_id AND s.id = 1;

  -- Charged today: the sprayer's own debits (the receiver's side is type 'receive').
  SELECT COALESCE(sum(abs(amount)), 0) INTO v_charged
    FROM public.transactions
   WHERE user_id = p_sprayer_id AND type = 'spray' AND currency = 'NGN'
     AND status IN ('completed', 'pending', 'processing') AND created_at >= v_day;

  -- Waiting or on the floor and not charged yet (a charged hold has its transfer, counted above).
  SELECT COALESCE(sum(planned_amount_kobo), 0) INTO v_waiting
    FROM public.spray_holds
   WHERE sprayer_id = p_sprayer_id AND status IN ('pending', 'queued', 'on_floor')
     AND transfer_id IS NULL AND created_at >= v_day;

  IF v_charged + v_waiting + p_amount_kobo > COALESCE(v_limit, 0) THEN
    -- The number is what is left today, in kobo; the spray function turns it into a sentence.
    RAISE EXCEPTION 'SPRAY_DAILY_LIMIT %', GREATEST(COALESCE(v_limit, 0) - v_charged - v_waiting, 0);
  END IF;
END;
$$;
REVOKE ALL ON FUNCTION public.spray_daily_check(uuid, bigint) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.spray_daily_check(uuid, bigint) TO service_role;

-- ── Spray functions: unchanged except for the one daily-allowance line ───────────────────────────
CREATE OR REPLACE FUNCTION public.queue_floor_spray(p_event_id uuid, p_sprayer_id uuid, p_amount_kobo bigint, p_denomination integer, p_note_count integer, p_recipient_id uuid DEFAULT NULL::uuid)
 RETURNS uuid
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $$
DECLARE
  v_event RECORD;
  v_wallet RECORD;
  v_settings jsonb := public.floor_settings();
  v_hold_id uuid;
BEGIN
  IF p_amount_kobo <= 0 THEN RAISE EXCEPTION 'Spray amount must be positive'; END IF;
  IF p_denomination NOT IN (200, 500, 1000) THEN RAISE EXCEPTION 'Invalid denomination'; END IF;
  IF p_note_count <= 0 OR p_amount_kobo <> p_denomination::bigint * 100 * p_note_count THEN
    RAISE EXCEPTION 'amount must be divisible by denomination';
  END IF;

  SELECT id, host_id, status INTO v_event FROM public.events WHERE id = p_event_id;
  IF NOT FOUND THEN RAISE EXCEPTION 'Event not found'; END IF;
  IF v_event.status <> 'live' THEN RAISE EXCEPTION 'Event is not live'; END IF;
  IF v_event.host_id = p_sprayer_id THEN RAISE EXCEPTION 'Host cannot spray own event'; END IF;

  -- The host, or a guest the host has called up (never the sprayer). Locked in here: removal later does not undo it.
  IF p_recipient_id IS NOT NULL AND p_recipient_id <> v_event.host_id THEN
    IF p_recipient_id = p_sprayer_id OR NOT EXISTS (
         SELECT 1 FROM public.event_call_ups WHERE event_id = p_event_id AND guest_id = p_recipient_id AND status = 'accepted') THEN
      RAISE EXCEPTION 'CALLUP_RECIPIENT_INVALID';
    END IF;
  END IF;

  IF EXISTS (SELECT 1 FROM public.spray_holds WHERE event_id = p_event_id AND sprayer_id = p_sprayer_id
                AND status IN ('queued', 'on_floor')) THEN
    RAISE EXCEPTION 'FLOOR_ALREADY_IN';
  END IF;

  SELECT id, balance, locked_balance INTO v_wallet
    FROM public.wallets WHERE user_id = p_sprayer_id AND currency = 'NGN' FOR UPDATE;
  IF NOT FOUND THEN RAISE EXCEPTION 'Wallet not found'; END IF;
  IF v_wallet.balance - v_wallet.locked_balance < p_amount_kobo THEN RAISE EXCEPTION 'Insufficient balance'; END IF;
  -- Daily allowance (115): refused here, before anything is held or charged.
  PERFORM public.spray_daily_check(p_sprayer_id, p_amount_kobo);

  UPDATE public.wallets SET locked_balance = locked_balance + p_amount_kobo, updated_at = now() WHERE id = v_wallet.id;

  BEGIN
    INSERT INTO public.spray_holds (
      event_id, sprayer_id, wallet_id, recipient_id, planned_amount_kobo, denomination, note_count, metadata,
      status, queued_at, floor_band_seconds, expires_at)
    VALUES (
      p_event_id, p_sprayer_id, v_wallet.id, NULLIF(p_recipient_id, v_event.host_id), p_amount_kobo, p_denomination, p_note_count, '{"floor": true}'::jsonb,
      'queued', clock_timestamp(), public.floor_band_seconds(v_settings, p_amount_kobo),
      now() + make_interval(secs => (v_settings->>'max_wait_seconds')::int))
    RETURNING id INTO v_hold_id;
  EXCEPTION WHEN unique_violation THEN
    RAISE EXCEPTION 'FLOOR_ALREADY_IN';
  END;

  PERFORM public.advance_event_floor(p_event_id);
  PERFORM public._floor_ping(p_event_id);
  RETURN v_hold_id;
END;
$$;

CREATE OR REPLACE FUNCTION public.create_spray_hold(p_event_id uuid, p_sprayer_id uuid, p_amount_kobo bigint, p_denomination integer, p_note_count integer, p_metadata jsonb DEFAULT '{}'::jsonb, p_expires_sec integer DEFAULT 600)
 RETURNS uuid
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
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
  -- Daily allowance (115): refused here, before anything is held or charged.
  PERFORM public.spray_daily_check(p_sprayer_id, p_amount_kobo);

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

CREATE OR REPLACE FUNCTION public.record_event_spray(p_event_id uuid, p_sprayer_id uuid, p_amount_kobo bigint, p_denomination integer, p_note_count integer, p_metadata jsonb DEFAULT '{}'::jsonb)
 RETURNS uuid
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
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
  -- Daily allowance (115): refused here, before anything is held or charged.
  PERFORM public.spray_daily_check(p_sprayer_id, p_amount_kobo);

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

-- ── Giveaway minimums from settings (the function is otherwise as in 113) ────────────────────────
CREATE OR REPLACE FUNCTION public.create_giveaway_funded(
  p_creator_id UUID,
  p_title TEXT,
  p_total_kobo BIGINT,
  p_per_person_kobo BIGINT,
  p_type public.giveaway_type,
  p_event_id UUID DEFAULT NULL,
  p_is_private BOOLEAN DEFAULT false,
  p_show_on_event_screen BOOLEAN DEFAULT true,
  p_idempotency_key TEXT DEFAULT NULL
)
RETURNS JSONB
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_wallet_id UUID;
  v_fund_txn_id UUID;
  v_giveaway public.giveaways%ROWTYPE;
  v_idem TEXT;
  v_limit BIGINT;
  v_used BIGINT;
  v_min_total BIGINT;
  v_min_each BIGINT;
  v_price BIGINT;
BEGIN
  -- The minimums are settings (115); the message is in bundles, as the app shows amounts.
  SELECT giveaway_min_total_kobo, giveaway_min_per_person_kobo, bundle_price_kobo
    INTO v_min_total, v_min_each, v_price FROM public.platform_settings WHERE id = 1;
  IF p_total_kobo < COALESCE(v_min_total, 10000) THEN
    RAISE EXCEPTION 'Minimum total is % bundles', to_char(CEIL(COALESCE(v_min_total, 10000)::numeric / COALESCE(v_price, 100)), 'FM999,999,999,999');
  END IF;
  IF p_per_person_kobo < COALESCE(v_min_each, 1000) THEN
    RAISE EXCEPTION 'Minimum per person is % bundles', to_char(CEIL(COALESCE(v_min_each, 1000)::numeric / COALESCE(v_price, 100)), 'FM999,999,999,999');
  END IF;
  IF p_per_person_kobo > p_total_kobo THEN
    RAISE EXCEPTION 'per_person_amount cannot exceed total_amount';
  END IF;
  IF p_total_kobo % p_per_person_kobo <> 0 THEN
    RAISE EXCEPTION 'total_amount must be evenly divisible by per_person_amount';
  END IF;

  IF p_event_id IS NOT NULL THEN
    IF p_type IS DISTINCT FROM 'live'::public.giveaway_type THEN
      RAISE EXCEPTION 'Event giveaways must be type live';
    END IF;

    IF NOT EXISTS (
      SELECT 1
      FROM public.events e
      WHERE e.id = p_event_id
        AND e.status = 'live'
        AND (
          e.host_id = p_creator_id
          OR EXISTS (
            SELECT 1
            FROM public.event_participants ep
            WHERE ep.event_id = e.id
              AND ep.user_id = p_creator_id
          )
        )
    ) THEN
      RAISE EXCEPTION 'Join this live event before dropping a giveaway on it';
    END IF;
  END IF;

  -- Locked, so two giveaways sent at the same moment are counted one after the other.
  SELECT id INTO v_wallet_id
  FROM public.wallets
  WHERE user_id = p_creator_id AND currency = 'NGN'
  FOR UPDATE;

  IF v_wallet_id IS NULL THEN
    RAISE EXCEPTION 'NGN wallet not found';
  END IF;

  -- Daily limit (113). Today is the UTC day, as for transfers. Every giveaway funded today counts in
  -- full, stopped ones too, so stop-and-recreate is not a way round it.
  SELECT CASE WHEN u.kyc_level >= 2 THEN s.giveaway_daily_limit_l2_kobo
              WHEN u.kyc_level = 1 THEN s.giveaway_daily_limit_l1_kobo
              ELSE 0 END
    INTO v_limit
    FROM public.users u CROSS JOIN public.platform_settings s
   WHERE u.id = p_creator_id AND s.id = 1;

  SELECT COALESCE(sum(total_amount), 0) INTO v_used
    FROM public.giveaways
   WHERE creator_id = p_creator_id
     AND created_at >= date_trunc('day', now() AT TIME ZONE 'UTC') AT TIME ZONE 'UTC';

  IF v_used + p_total_kobo > COALESCE(v_limit, 0) THEN
    -- The number is what is left today, in kobo; the giveaway function turns it into a sentence.
    RAISE EXCEPTION 'GIVEAWAY_DAILY_LIMIT %', GREATEST(COALESCE(v_limit, 0) - v_used, 0);
  END IF;

  v_idem := COALESCE(p_idempotency_key, 'giveaway-fund-' || gen_random_uuid()::text);

  v_fund_txn_id := public.debit_wallet(
    v_wallet_id,
    p_creator_id,
    p_total_kobo,
    0,
    'giveaway',
    'Giveaway funding: ' || p_title,
    'internal',
    v_idem,
    jsonb_build_object('title', p_title)
  );

  INSERT INTO public.giveaways (
    creator_id,
    title,
    total_amount,
    per_person_amount,
    remaining_amount,
    type,
    event_id,
    is_private,
    show_on_event_screen,
    funding_transaction_id
  ) VALUES (
    p_creator_id,
    p_title,
    p_total_kobo,
    p_per_person_kobo,
    p_total_kobo,
    p_type,
    p_event_id,
    COALESCE(p_is_private, false),
    COALESCE(p_show_on_event_screen, true),
    v_fund_txn_id
  )
  RETURNING * INTO v_giveaway;

  RETURN jsonb_build_object(
    'id', v_giveaway.id,
    'code', v_giveaway.code,
    'total_amount', v_giveaway.total_amount,
    'per_person_amount', v_giveaway.per_person_amount,
    'max_recipients', v_giveaway.max_recipients,
    'status', v_giveaway.status,
    'funding_transaction_id', v_fund_txn_id
  );
END;
$$;

-- ── Reading and setting the limits ───────────────────────────────────────────────────────────────
CREATE OR REPLACE FUNCTION public.platform_limits_json()
RETURNS jsonb
LANGUAGE sql
STABLE
SET search_path = public
AS $$
  SELECT jsonb_build_object(
    'bundle_min_purchase', bundle_min_purchase,
    'bundle_sell_min', bundle_sell_min,
    'sell_daily_limit_kobo', withdrawal_daily_limit_l2_kobo,
    'spray_max_single_kobo', spray_max_single_ngn_kobo,
    'spray_daily_l1_kobo', spray_daily_limit_l1_kobo,
    'spray_daily_l2_kobo', spray_daily_limit_l2_kobo,
    'giveaway_min_total_kobo', giveaway_min_total_kobo,
    'giveaway_min_per_person_kobo', giveaway_min_per_person_kobo)
  FROM public.platform_settings WHERE id = 1
$$;
REVOKE ALL ON FUNCTION public.platform_limits_json() FROM PUBLIC, anon, authenticated;

CREATE OR REPLACE FUNCTION public.get_platform_limits()
RETURNS jsonb
LANGUAGE plpgsql
STABLE
SECURITY DEFINER
SET search_path = public
AS $$
BEGIN
  IF NOT EXISTS (SELECT 1 FROM public.admin_roles WHERE user_id = auth.uid() AND status = 'active') THEN
    RAISE EXCEPTION 'Only admins can read limits';
  END IF;
  RETURN public.platform_limits_json();
END;
$$;

-- Minimums for purchase and sale are in bundles (as stored); everything else is in kobo.
CREATE OR REPLACE FUNCTION public.set_platform_limits(
  _bundle_min_purchase bigint,
  _bundle_sell_min bigint,
  _sell_daily_limit_kobo bigint,
  _spray_max_single_kobo bigint,
  _spray_daily_l1_kobo bigint,
  _spray_daily_l2_kobo bigint,
  _giveaway_min_total_kobo bigint,
  _giveaway_min_per_person_kobo bigint
)
RETURNS void
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  _admin_id uuid := auth.uid();
  _before jsonb;
BEGIN
  IF _admin_id IS NULL OR NOT public.has_admin_role(_admin_id, 'super_admin') THEN
    RAISE EXCEPTION 'Only super admins can change limits';
  END IF;
  IF _bundle_min_purchase IS NULL OR _bundle_sell_min IS NULL OR _sell_daily_limit_kobo IS NULL
     OR _spray_max_single_kobo IS NULL OR _spray_daily_l1_kobo IS NULL OR _spray_daily_l2_kobo IS NULL
     OR _giveaway_min_total_kobo IS NULL OR _giveaway_min_per_person_kobo IS NULL THEN
    RAISE EXCEPTION 'Every limit is required';
  END IF;
  IF LEAST(_sell_daily_limit_kobo, _spray_max_single_kobo, _spray_daily_l1_kobo, _spray_daily_l2_kobo,
           _bundle_min_purchase, _bundle_sell_min, _giveaway_min_total_kobo, _giveaway_min_per_person_kobo) < 0 THEN
    RAISE EXCEPTION 'A limit cannot be negative';
  END IF;
  -- A minimum of 0 would let through amounts the fee cannot be taken from; one bundle is 100 kobo.
  IF _bundle_min_purchase < 1 OR _bundle_sell_min < 1 OR _giveaway_min_total_kobo < 100 OR _giveaway_min_per_person_kobo < 100 THEN
    RAISE EXCEPTION 'A minimum must be at least 1';
  END IF;
  IF _spray_daily_l2_kobo < _spray_daily_l1_kobo THEN
    RAISE EXCEPTION 'A verified limit cannot be lower than the email-only limit';
  END IF;
  IF _giveaway_min_per_person_kobo > _giveaway_min_total_kobo THEN
    RAISE EXCEPTION 'The smallest share per person cannot be more than the smallest giveaway';
  END IF;
  -- The smallest note is 200 bundles (20,000 kobo): a lower ceiling would stop every spray.
  IF _spray_max_single_kobo < 20000 THEN
    RAISE EXCEPTION 'The largest spray must be at least 200 bundles (one note)';
  END IF;

  PERFORM 1 FROM public.platform_settings WHERE id = 1 FOR UPDATE;
  _before := public.platform_limits_json();

  UPDATE public.platform_settings
     SET bundle_min_purchase = _bundle_min_purchase,
         bundle_sell_min = _bundle_sell_min,
         withdrawal_daily_limit_l2_kobo = _sell_daily_limit_kobo,
         spray_max_single_ngn_kobo = _spray_max_single_kobo,
         spray_daily_limit_l1_kobo = _spray_daily_l1_kobo,
         spray_daily_limit_l2_kobo = _spray_daily_l2_kobo,
         giveaway_min_total_kobo = _giveaway_min_total_kobo,
         giveaway_min_per_person_kobo = _giveaway_min_per_person_kobo,
         updated_at = now(), updated_by = _admin_id
   WHERE id = 1;

  PERFORM public.log_admin_action(_admin_id, 'set_platform_limits', 'platform_settings', NULL,
    public.platform_limits_json() || jsonb_build_object('before', _before));
END;
$$;

-- What the app needs to check a form before it asks the server, in whole bundles. Daily allowances
-- are not given out; the server enforces them and says what is left when one is reached.
CREATE OR REPLACE FUNCTION public.app_limits()
RETURNS jsonb
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path = public
AS $$
  SELECT jsonb_build_object(
    'min_purchase', bundle_min_purchase,
    'min_sell', bundle_sell_min,
    'max_spray', spray_max_single_ngn_kobo / bundle_price_kobo,
    'min_giveaway_total', CEIL(giveaway_min_total_kobo::numeric / bundle_price_kobo)::bigint,
    'min_giveaway_per_person', CEIL(giveaway_min_per_person_kobo::numeric / bundle_price_kobo)::bigint)
  FROM public.platform_settings WHERE id = 1
$$;

REVOKE ALL ON FUNCTION public.get_platform_limits() FROM PUBLIC, anon;
REVOKE ALL ON FUNCTION public.set_platform_limits(bigint, bigint, bigint, bigint, bigint, bigint, bigint, bigint) FROM PUBLIC, anon;
REVOKE ALL ON FUNCTION public.app_limits() FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.get_platform_limits() TO authenticated;
GRANT EXECUTE ON FUNCTION public.set_platform_limits(bigint, bigint, bigint, bigint, bigint, bigint, bigint, bigint) TO authenticated;
GRANT EXECUTE ON FUNCTION public.app_limits() TO authenticated, service_role;
