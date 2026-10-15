-- Dance floor queue (part 1). Spec: DOINGSNEWFACE docs/superpowers/specs/2026-10-15-dance-floor-queue-design.md
-- Floor sprays are spray_holds rows: queued -> on_floor -> settled | released. Old-app rows
-- (pending/expired/pause) are untouched; settle_spray_hold and create_spray_hold are unchanged.

-- ── A. Schema, settings, pure maths ────────────────────────────────────────────────────────

ALTER TABLE public.spray_holds
  ADD COLUMN IF NOT EXISTS queued_at TIMESTAMPTZ,
  ADD COLUMN IF NOT EXISTS floor_band_seconds INT,
  ADD COLUMN IF NOT EXISTS floor_seconds INT,
  ADD COLUMN IF NOT EXISTS floor_slot SMALLINT CHECK (floor_slot BETWEEN 1 AND 8),
  ADD COLUMN IF NOT EXISTS floor_started_at TIMESTAMPTZ,
  ADD COLUMN IF NOT EXISTS floor_ends_at TIMESTAMPTZ,
  ADD COLUMN IF NOT EXISTS release_reason TEXT CHECK (release_reason IN ('left', 'max_wait', 'event_ended'));

CREATE UNIQUE INDEX IF NOT EXISTS uq_spray_holds_floor_slot
  ON public.spray_holds (event_id, floor_slot) WHERE status = 'on_floor';
CREATE UNIQUE INDEX IF NOT EXISTS uq_spray_holds_floor_person
  ON public.spray_holds (event_id, sprayer_id) WHERE status IN ('queued', 'on_floor');
CREATE INDEX IF NOT EXISTS idx_spray_holds_floor_queue
  ON public.spray_holds (event_id, status, queued_at) WHERE status IN ('queued', 'on_floor');

CREATE OR REPLACE FUNCTION public.floor_default_settings()
RETURNS jsonb LANGUAGE sql IMMUTABLE AS $$
  SELECT '{"bands":[{"from_ngn":0,"seconds":60},{"from_ngn":5000,"seconds":120},{"from_ngn":50000,"seconds":240},{"from_ngn":200000,"seconds":360}],"busy_threshold":10,"busy_shrink_pct":30,"min_seconds":45,"max_wait_seconds":1800}'::jsonb
$$;

ALTER TABLE public.platform_settings
  ADD COLUMN IF NOT EXISTS spray_floor_settings JSONB NOT NULL DEFAULT public.floor_default_settings();

COMMENT ON COLUMN public.platform_settings.spray_floor_settings IS
  'Dance floor turn bands, busy-floor rule and max wait. Write only via set_spray_floor_settings (validated).';

CREATE OR REPLACE FUNCTION public.floor_settings()
RETURNS jsonb LANGUAGE sql STABLE SECURITY DEFINER SET search_path = public AS $$
  SELECT COALESCE((SELECT spray_floor_settings FROM public.platform_settings WHERE id = 1), public.floor_default_settings())
$$;

CREATE OR REPLACE FUNCTION public.floor_band_seconds(p_settings jsonb, p_amount_kobo bigint)
RETURNS int LANGUAGE sql IMMUTABLE AS $$
  SELECT COALESCE(
    (SELECT (b->>'seconds')::int FROM jsonb_array_elements(p_settings->'bands') WITH ORDINALITY AS t(b, i)
      WHERE (b->>'from_ngn')::bigint * 100 <= p_amount_kobo ORDER BY i DESC LIMIT 1),
    (SELECT (b->>'seconds')::int FROM jsonb_array_elements(p_settings->'bands') WITH ORDINALITY AS t(b, i)
      ORDER BY i LIMIT 1)
  )
$$;

CREATE OR REPLACE FUNCTION public.floor_turn_seconds(p_settings jsonb, p_band_seconds int, p_waiting int)
RETURNS int LANGUAGE sql IMMUTABLE AS $$
  SELECT CASE
    WHEN p_waiting > (p_settings->>'busy_threshold')::int THEN
      GREATEST((p_settings->>'min_seconds')::int,
               round(p_band_seconds * (1 - (p_settings->>'busy_shrink_pct')::numeric / 100))::int)
    ELSE p_band_seconds
  END
$$;

-- Same integer formula as the app's sprayedNotes (src/lib/floor.ts).
CREATE OR REPLACE FUNCTION public.floor_charged_kobo(p_note_count int, p_denomination int, p_floor_seconds int, p_elapsed_ms bigint)
RETURNS bigint LANGUAGE sql IMMUTABLE AS $$
  SELECT (floor(p_note_count::numeric * LEAST(GREATEST(p_elapsed_ms, 0), p_floor_seconds::bigint * 1000)
                / (p_floor_seconds::bigint * 1000)))::bigint * p_denomination * 100
$$;

CREATE OR REPLACE FUNCTION public._floor_elapsed_ms(p_started timestamptz)
RETURNS bigint LANGUAGE sql STABLE AS $$
  SELECT floor(extract(epoch FROM (now() - p_started)) * 1000)::bigint
$$;

CREATE OR REPLACE FUNCTION public.floor_settings_errors(p jsonb)
RETURNS text LANGUAGE plpgsql STABLE SECURITY DEFINER SET search_path = public AS $$
DECLARE
  v_band jsonb;
  v_prev numeric := -1;
  v_count int;
  v_min_band int := NULL;
BEGIN
  IF jsonb_typeof(p->'bands') <> 'array' THEN RETURN 'bands must be a list'; END IF;
  v_count := jsonb_array_length(p->'bands');
  IF v_count < 1 OR v_count > 6 THEN RETURN 'Use 1 to 6 bands'; END IF;
  FOR v_band IN SELECT value FROM jsonb_array_elements(p->'bands') LOOP
    IF jsonb_typeof(v_band->'from_ngn') <> 'number' OR jsonb_typeof(v_band->'seconds') <> 'number' THEN
      RETURN 'Each band needs from_ngn and seconds';
    END IF;
    IF v_prev < 0 AND (v_band->>'from_ngn')::numeric <> 0 THEN
      RETURN 'The first band must start at ₦0';
    END IF;
    IF (v_band->>'from_ngn')::numeric <= v_prev OR (v_band->>'from_ngn')::numeric <> floor((v_band->>'from_ngn')::numeric) THEN
      RETURN 'Band amounts must be whole naira and go up';
    END IF;
    IF (v_band->>'seconds')::numeric NOT BETWEEN 15 AND 900 OR (v_band->>'seconds')::numeric <> floor((v_band->>'seconds')::numeric) THEN
      RETURN 'Band times must be whole seconds from 15 to 900';
    END IF;
    v_prev := (v_band->>'from_ngn')::numeric;
    v_min_band := LEAST(COALESCE(v_min_band, (v_band->>'seconds')::int), (v_band->>'seconds')::int);
  END LOOP;
  IF jsonb_typeof(p->'busy_threshold') <> 'number' OR (p->>'busy_threshold')::numeric < 1 THEN RETURN 'busy_threshold must be at least 1'; END IF;
  IF jsonb_typeof(p->'busy_shrink_pct') <> 'number' OR (p->>'busy_shrink_pct')::numeric NOT BETWEEN 0 AND 70 THEN RETURN 'busy_shrink_pct must be 0 to 70'; END IF;
  IF jsonb_typeof(p->'min_seconds') <> 'number' OR (p->>'min_seconds')::numeric < 15 OR (p->>'min_seconds')::numeric > v_min_band THEN
    RETURN 'min_seconds must be from 15 to the shortest band';
  END IF;
  IF jsonb_typeof(p->'max_wait_seconds') <> 'number' OR (p->>'max_wait_seconds')::numeric NOT BETWEEN 300 AND 7200 THEN
    RETURN 'max_wait_seconds must be 300 to 7200';
  END IF;
  RETURN NULL;
END;
$$;

CREATE OR REPLACE FUNCTION public.get_spray_floor_settings()
RETURNS jsonb LANGUAGE plpgsql STABLE SECURITY DEFINER SET search_path = public AS $$
BEGIN
  IF NOT (public.has_admin_role(auth.uid(), 'super_admin') OR public.has_admin_role(auth.uid(), 'finance')
          OR public.has_admin_role(auth.uid(), 'support')) THEN
    RAISE EXCEPTION 'Not authorized';
  END IF;
  RETURN public.floor_settings();
END;
$$;

CREATE OR REPLACE FUNCTION public.set_spray_floor_settings(p jsonb)
RETURNS jsonb LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
DECLARE v_err text;
BEGIN
  IF auth.uid() IS NULL OR NOT (public.has_admin_role(auth.uid(), 'super_admin') OR public.has_admin_role(auth.uid(), 'finance')) THEN
    RAISE EXCEPTION 'Not authorized';
  END IF;
  v_err := public.floor_settings_errors(p);
  IF v_err IS NOT NULL THEN RAISE EXCEPTION 'Invalid floor settings: %', v_err; END IF;
  UPDATE public.platform_settings
     SET spray_floor_settings = jsonb_build_object(
           'bands', p->'bands', 'busy_threshold', (p->>'busy_threshold')::int,
           'busy_shrink_pct', (p->>'busy_shrink_pct')::int, 'min_seconds', (p->>'min_seconds')::int,
           'max_wait_seconds', (p->>'max_wait_seconds')::int)
   WHERE id = 1;
  RETURN public.floor_settings();
END;
$$;

REVOKE ALL ON FUNCTION public.floor_settings() FROM PUBLIC, anon, authenticated;
REVOKE ALL ON FUNCTION public.floor_settings_errors(jsonb) FROM PUBLIC, anon, authenticated;
REVOKE ALL ON FUNCTION public.get_spray_floor_settings() FROM PUBLIC, anon, authenticated;
REVOKE ALL ON FUNCTION public.set_spray_floor_settings(jsonb) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.floor_settings() TO service_role;
GRANT EXECUTE ON FUNCTION public.floor_settings_errors(jsonb) TO service_role;
GRANT EXECUTE ON FUNCTION public.get_spray_floor_settings() TO authenticated, service_role;
GRANT EXECUTE ON FUNCTION public.set_spray_floor_settings(jsonb) TO authenticated, service_role;

-- ── B. Settle core, queue, stop, leave ─────────────────────────────────────────────────────

-- Ping screens to re-read the floor. Never lets a realtime problem break money code.
CREATE OR REPLACE FUNCTION public._floor_ping(p_event_id uuid)
RETURNS void LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
BEGIN
  PERFORM realtime.send(jsonb_build_object('at', now()), 'floor_changed', 'floor:' || p_event_id::text, false);
EXCEPTION WHEN others THEN
  RAISE WARNING 'floor ping failed: %', SQLERRM;
END;
$$;

-- Charge p_charged_kobo (0 = release) for a queued/on_floor hold. Same ledger writes and idempotency
-- keys as settle_spray_hold (live definition, 2026-10-15) so totals, Top Sprayers and the host
-- credit behave the same. Lock order: hold -> sprayer wallet (no event row lock). Allows a
-- non-live event so turns can be settled after the host ends it. Closed rows are a no-op.
CREATE OR REPLACE FUNCTION public._settle_floor_hold(p_hold_id uuid, p_charged_kobo bigint, p_release_reason text DEFAULT NULL)
RETURNS void LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
DECLARE
  v_hold RECORD;
  v_host uuid;
  v_receiver_wallet uuid;
  v_transfer_id uuid;
  v_sender_txn_id uuid;
  v_receiver_txn_id uuid;
  v_idem_key text;
  v_note_count int;
  v_metadata jsonb;
  v_settlement public.spray_settlement_type;
BEGIN
  SELECT * INTO v_hold FROM public.spray_holds WHERE id = p_hold_id FOR UPDATE;
  IF NOT FOUND THEN RAISE EXCEPTION 'Spray hold not found'; END IF;
  IF v_hold.status NOT IN ('queued', 'on_floor') THEN RETURN; END IF;
  IF p_charged_kobo < 0 OR p_charged_kobo > v_hold.planned_amount_kobo
     OR p_charged_kobo % (v_hold.denomination * 100) <> 0 THEN
    RAISE EXCEPTION 'Invalid floor charge';
  END IF;
  IF v_hold.status = 'queued' AND p_charged_kobo <> 0 THEN RAISE EXCEPTION 'Queued spray cannot be charged'; END IF;

  PERFORM 1 FROM public.wallets WHERE id = v_hold.wallet_id FOR UPDATE;

  -- Release the hold before the debit so the available balance includes the reserved funds.
  UPDATE public.wallets
     SET locked_balance = locked_balance - v_hold.planned_amount_kobo, updated_at = now()
   WHERE id = v_hold.wallet_id;

  IF p_charged_kobo = 0 THEN
    UPDATE public.spray_holds
       SET status = 'released', settlement_type = 'cancelled', charged_amount_kobo = 0,
           release_reason = p_release_reason, settled_at = now()
     WHERE id = p_hold_id;
    RETURN;
  END IF;

  SELECT host_id INTO v_host FROM public.events WHERE id = v_hold.event_id;
  SELECT id INTO v_receiver_wallet FROM public.wallets WHERE user_id = v_host AND currency = 'NGN';
  IF v_receiver_wallet IS NULL THEN RAISE EXCEPTION 'Receiver wallet not found'; END IF;

  v_settlement := CASE WHEN p_charged_kobo = v_hold.planned_amount_kobo THEN 'full' ELSE 'partial' END;
  v_note_count := p_charged_kobo / (v_hold.denomination * 100);
  v_idem_key := 'spray-hold-' || p_hold_id::text;
  v_metadata := v_hold.metadata || jsonb_build_object(
    'hold_id', p_hold_id, 'settlement', v_settlement::text, 'floor', true,
    'planned_amount_kobo', v_hold.planned_amount_kobo, 'charged_amount_kobo', p_charged_kobo,
    'floor_seconds', v_hold.floor_seconds);

  v_sender_txn_id := public.debit_wallet(
    v_hold.wallet_id, v_hold.sprayer_id, p_charged_kobo, 0, 'spray',
    'Spray at event ' || v_hold.event_id::text || ' (sent)', 'internal', v_idem_key || '-send', v_metadata);

  v_receiver_txn_id := public.credit_wallet(
    v_receiver_wallet, v_host, p_charged_kobo, 0, 'receive',
    'Spray at event ' || v_hold.event_id::text || ' (received)', 'internal', NULL, v_idem_key || '-recv', v_metadata);

  INSERT INTO public.transfers (
    sender_wallet_id, receiver_wallet_id, sender_user_id, receiver_user_id, currency, amount, fee,
    status, sender_transaction_id, receiver_transaction_id, description)
  SELECT v_hold.wallet_id, v_receiver_wallet, v_hold.sprayer_id, v_host, w.currency, p_charged_kobo, 0,
         'completed', v_sender_txn_id, v_receiver_txn_id, 'Spray at event ' || v_hold.event_id::text
    FROM public.wallets w WHERE w.id = v_hold.wallet_id
  RETURNING id INTO v_transfer_id;

  INSERT INTO public.spray_records (event_id, sprayer_id, receiver_id, transaction_id, amount, denomination, note_count, metadata)
  VALUES (v_hold.event_id, v_hold.sprayer_id, v_host, v_sender_txn_id, p_charged_kobo, v_hold.denomination, v_note_count,
          COALESCE(v_metadata, '{}'::jsonb));

  UPDATE public.spray_holds
     SET status = 'settled', settlement_type = v_settlement, charged_amount_kobo = p_charged_kobo,
         transfer_id = v_transfer_id, release_reason = NULL, settled_at = now()
   WHERE id = p_hold_id;
END;
$$;

CREATE OR REPLACE FUNCTION public.queue_floor_spray(
  p_event_id uuid, p_sprayer_id uuid, p_amount_kobo bigint, p_denomination int, p_note_count int)
RETURNS uuid LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
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

  IF EXISTS (SELECT 1 FROM public.spray_holds WHERE event_id = p_event_id AND sprayer_id = p_sprayer_id
                AND status IN ('queued', 'on_floor')) THEN
    RAISE EXCEPTION 'FLOOR_ALREADY_IN';
  END IF;

  SELECT id, balance, locked_balance INTO v_wallet
    FROM public.wallets WHERE user_id = p_sprayer_id AND currency = 'NGN' FOR UPDATE;
  IF NOT FOUND THEN RAISE EXCEPTION 'Wallet not found'; END IF;
  IF v_wallet.balance - v_wallet.locked_balance < p_amount_kobo THEN RAISE EXCEPTION 'Insufficient balance'; END IF;

  UPDATE public.wallets SET locked_balance = locked_balance + p_amount_kobo, updated_at = now() WHERE id = v_wallet.id;

  BEGIN
    INSERT INTO public.spray_holds (
      event_id, sprayer_id, wallet_id, planned_amount_kobo, denomination, note_count, metadata,
      status, queued_at, floor_band_seconds, expires_at)
    VALUES (
      p_event_id, p_sprayer_id, v_wallet.id, p_amount_kobo, p_denomination, p_note_count, '{"floor": true}'::jsonb,
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

CREATE OR REPLACE FUNCTION public.stop_floor_spray(p_hold_id uuid, p_sprayer_id uuid)
RETURNS uuid LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
DECLARE v_hold RECORD;
BEGIN
  SELECT id, event_id, sprayer_id, status, note_count, denomination, floor_seconds, floor_started_at
    INTO v_hold FROM public.spray_holds WHERE id = p_hold_id;
  IF NOT FOUND THEN RAISE EXCEPTION 'Spray hold not found'; END IF;
  IF v_hold.sprayer_id <> p_sprayer_id THEN RAISE EXCEPTION 'Not authorized for this spray hold'; END IF;
  IF v_hold.status = 'on_floor' THEN
    PERFORM public._settle_floor_hold(p_hold_id,
      public.floor_charged_kobo(v_hold.note_count, v_hold.denomination, v_hold.floor_seconds,
                                public._floor_elapsed_ms(v_hold.floor_started_at)));
    PERFORM public.advance_event_floor(v_hold.event_id);
    PERFORM public._floor_ping(v_hold.event_id);
  END IF;
  RETURN v_hold.event_id;
END;
$$;

CREATE OR REPLACE FUNCTION public.leave_floor_queue(p_hold_id uuid, p_sprayer_id uuid)
RETURNS uuid LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
DECLARE v_hold RECORD;
BEGIN
  SELECT id, event_id, sprayer_id, status INTO v_hold FROM public.spray_holds WHERE id = p_hold_id;
  IF NOT FOUND THEN RAISE EXCEPTION 'Spray hold not found'; END IF;
  IF v_hold.sprayer_id <> p_sprayer_id THEN RAISE EXCEPTION 'Not authorized for this spray hold'; END IF;
  IF v_hold.status = 'queued' THEN
    PERFORM public._settle_floor_hold(p_hold_id, 0, 'left');
    PERFORM public._floor_ping(v_hold.event_id);
  END IF;
  RETURN v_hold.event_id;
END;
$$;

REVOKE ALL ON FUNCTION public._floor_ping(uuid) FROM PUBLIC, anon, authenticated;
REVOKE ALL ON FUNCTION public._settle_floor_hold(uuid, bigint, text) FROM PUBLIC, anon, authenticated;
REVOKE ALL ON FUNCTION public.queue_floor_spray(uuid, uuid, bigint, int, int) FROM PUBLIC, anon, authenticated;
REVOKE ALL ON FUNCTION public.stop_floor_spray(uuid, uuid) FROM PUBLIC, anon, authenticated;
REVOKE ALL ON FUNCTION public.leave_floor_queue(uuid, uuid) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public._floor_ping(uuid) TO service_role;
GRANT EXECUTE ON FUNCTION public._settle_floor_hold(uuid, bigint, text) TO service_role;
GRANT EXECUTE ON FUNCTION public.queue_floor_spray(uuid, uuid, bigint, int, int) TO service_role;
GRANT EXECUTE ON FUNCTION public.stop_floor_spray(uuid, uuid) TO service_role;
GRANT EXECUTE ON FUNCTION public.leave_floor_queue(uuid, uuid) TO service_role;

-- ── C. Advancing the floor ─────────────────────────────────────────────────────────────────

-- Settle inside advance without letting one bad row (e.g. a sprayer whose verification was revoked)
-- break the floor for everyone: the row's changes roll back to the savepoint, it stays where it
-- was, the failure is logged, and the next advance retries it.
CREATE OR REPLACE FUNCTION public._floor_try_settle(p_hold_id uuid, p_charged_kobo bigint, p_release_reason text DEFAULT NULL)
RETURNS boolean LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
BEGIN
  PERFORM public._settle_floor_hold(p_hold_id, p_charged_kobo, p_release_reason);
  RETURN true;
EXCEPTION WHEN others THEN
  RAISE WARNING 'floor settle failed for hold %: %', p_hold_id, SQLERRM;
  RETURN false;
END;
$$;

-- Idempotent. Ends finished turns, releases stale/ended holds, fills free slots (lowest first,
-- FIFO). Only one run per event acts at a time (try-lock: a concurrent run is already doing it).
CREATE OR REPLACE FUNCTION public.advance_event_floor(p_event_id uuid)
RETURNS boolean LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
DECLARE
  v_status public.event_status;
  v_settings jsonb;
  v_changed boolean := false;
  v_slot int;
  v_waiting int;
  v_secs int;
  r RECORD;
BEGIN
  IF NOT EXISTS (SELECT 1 FROM public.spray_holds WHERE event_id = p_event_id AND status IN ('queued', 'on_floor')) THEN
    RETURN false;
  END IF;
  IF NOT pg_try_advisory_xact_lock(hashtext('floor:' || p_event_id::text)) THEN
    RETURN false;
  END IF;

  SELECT status INTO v_status FROM public.events WHERE id = p_event_id;

  IF v_status IS DISTINCT FROM 'live' THEN
    FOR r IN SELECT id, note_count, denomination, floor_seconds, floor_started_at
               FROM public.spray_holds WHERE event_id = p_event_id AND status = 'on_floor' LOOP
      PERFORM public._floor_try_settle(r.id,
        public.floor_charged_kobo(r.note_count, r.denomination, r.floor_seconds, public._floor_elapsed_ms(r.floor_started_at)),
        'event_ended');
    END LOOP;
    FOR r IN SELECT id FROM public.spray_holds WHERE event_id = p_event_id AND status = 'queued' LOOP
      PERFORM public._floor_try_settle(r.id, 0, 'event_ended');
    END LOOP;
    PERFORM public._floor_ping(p_event_id);
    RETURN true;
  END IF;

  v_settings := public.floor_settings();

  FOR r IN SELECT id, planned_amount_kobo FROM public.spray_holds
            WHERE event_id = p_event_id AND status = 'on_floor' AND floor_ends_at <= now() LOOP
    IF public._floor_try_settle(r.id, r.planned_amount_kobo) THEN v_changed := true; END IF;
  END LOOP;

  FOR r IN SELECT id FROM public.spray_holds
            WHERE event_id = p_event_id AND status = 'queued' AND expires_at <= now() LOOP
    IF public._floor_try_settle(r.id, 0, 'max_wait') THEN v_changed := true; END IF;
  END LOOP;

  LOOP
    SELECT s INTO v_slot FROM generate_series(1, 8) AS s
     WHERE NOT EXISTS (SELECT 1 FROM public.spray_holds
                        WHERE event_id = p_event_id AND status = 'on_floor' AND floor_slot = s)
     ORDER BY s LIMIT 1;
    EXIT WHEN v_slot IS NULL;

    SELECT id, floor_band_seconds INTO r FROM public.spray_holds
     WHERE event_id = p_event_id AND status = 'queued'
     ORDER BY queued_at, id LIMIT 1 FOR UPDATE;
    EXIT WHEN NOT FOUND;

    SELECT count(*) INTO v_waiting FROM public.spray_holds
     WHERE event_id = p_event_id AND status = 'queued' AND id <> r.id;
    v_secs := public.floor_turn_seconds(v_settings, r.floor_band_seconds, v_waiting);

    UPDATE public.spray_holds
       SET status = 'on_floor', floor_slot = v_slot, floor_seconds = v_secs,
           floor_started_at = now(), floor_ends_at = now() + make_interval(secs => v_secs)
     WHERE id = r.id;
    v_changed := true;
  END LOOP;

  IF v_changed THEN PERFORM public._floor_ping(p_event_id); END IF;
  RETURN v_changed;
END;
$$;

-- Backstop for cron-reconciliation: rooms nobody is watching still end turns and fill slots.
CREATE OR REPLACE FUNCTION public.advance_live_floors()
RETURNS int LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
DECLARE v_event uuid; v_count int := 0;
BEGIN
  FOR v_event IN SELECT DISTINCT event_id FROM public.spray_holds WHERE status IN ('queued', 'on_floor') LOOP
    PERFORM public.advance_event_floor(v_event);
    v_count := v_count + 1;
  END LOOP;
  RETURN v_count;
END;
$$;

REVOKE ALL ON FUNCTION public._floor_try_settle(uuid, bigint, text) FROM PUBLIC, anon, authenticated;
REVOKE ALL ON FUNCTION public.advance_event_floor(uuid) FROM PUBLIC, anon, authenticated;
REVOKE ALL ON FUNCTION public.advance_live_floors() FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public._floor_try_settle(uuid, bigint, text) TO service_role;
GRANT EXECUTE ON FUNCTION public.advance_event_floor(uuid) TO service_role;
GRANT EXECUTE ON FUNCTION public.advance_live_floors() TO service_role;
