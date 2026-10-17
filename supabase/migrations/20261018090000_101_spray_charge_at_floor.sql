-- Migration 101: a floor spray is charged in full when it steps onto the floor (sprayer debited, host
-- credited, final). Turn end / event end / admin removal of a charged hold move no money. Stop is
-- retired. A charge that fails at promotion releases the hold ('charge_failed') so the next person
-- steps up. Holds already on the floor before this (transfer_id IS NULL) keep the time-based settle.
-- Spec: DOINGSNEWFACE docs/superpowers/specs/2026-10-18-spray-charge-at-floor-design.md

ALTER TABLE public.spray_holds DROP CONSTRAINT IF EXISTS ck_spray_hold_release_reason;
-- NOT VALID then VALIDATE: checking existing rows doesn't hold an exclusive lock on this live table.
ALTER TABLE public.spray_holds ADD CONSTRAINT ck_spray_hold_release_reason
  CHECK (release_reason IN ('left', 'max_wait', 'event_ended', 'event_ended_on_floor', 'removed_by_admin', 'charge_failed')) NOT VALID;
ALTER TABLE public.spray_holds VALIDATE CONSTRAINT ck_spray_hold_release_reason;

-- The money half of a floor settle, run as the hold steps onto the floor. Idempotent: acts only on an
-- on_floor hold that hasn't been charged. The hold stays on_floor (it still occupies its slot).
CREATE OR REPLACE FUNCTION public._charge_floor_hold(p_hold_id uuid)
RETURNS void LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
DECLARE
  v_hold RECORD;
  v_host uuid;
  v_receiver_wallet uuid;
  v_transfer_id uuid;
  v_sender_txn_id uuid;
  v_receiver_txn_id uuid;
  v_idem_key text;
  v_metadata jsonb;
BEGIN
  SELECT * INTO v_hold FROM public.spray_holds WHERE id = p_hold_id FOR UPDATE;
  IF NOT FOUND THEN RAISE EXCEPTION 'Spray hold not found'; END IF;
  IF v_hold.status <> 'on_floor' OR v_hold.transfer_id IS NOT NULL THEN RETURN; END IF;

  PERFORM 1 FROM public.wallets WHERE id = v_hold.wallet_id FOR UPDATE;
  -- Release the hold before the debit so the available balance includes the reserved funds.
  UPDATE public.wallets
     SET locked_balance = locked_balance - v_hold.planned_amount_kobo, updated_at = now()
   WHERE id = v_hold.wallet_id;

  SELECT host_id INTO v_host FROM public.events WHERE id = v_hold.event_id;
  SELECT id INTO v_receiver_wallet FROM public.wallets WHERE user_id = v_host AND currency = 'NGN';
  IF v_receiver_wallet IS NULL THEN RAISE EXCEPTION 'Receiver wallet not found'; END IF;

  v_idem_key := 'spray-hold-' || p_hold_id::text;
  v_metadata := v_hold.metadata || jsonb_build_object(
    'hold_id', p_hold_id, 'settlement', 'full', 'floor', true, 'charged_at', 'floor_entry',
    'planned_amount_kobo', v_hold.planned_amount_kobo, 'charged_amount_kobo', v_hold.planned_amount_kobo,
    'floor_seconds', v_hold.floor_seconds);

  v_sender_txn_id := public.debit_wallet(
    v_hold.wallet_id, v_hold.sprayer_id, v_hold.planned_amount_kobo, 0, 'spray',
    'Spray at event ' || v_hold.event_id::text || ' (sent)', 'internal', v_idem_key || '-send', v_metadata);

  v_receiver_txn_id := public.credit_wallet(
    v_receiver_wallet, v_host, v_hold.planned_amount_kobo, 0, 'receive',
    'Spray at event ' || v_hold.event_id::text || ' (received)', 'internal', NULL, v_idem_key || '-recv', v_metadata);

  INSERT INTO public.transfers (
    sender_wallet_id, receiver_wallet_id, sender_user_id, receiver_user_id, currency, amount, fee,
    status, sender_transaction_id, receiver_transaction_id, description)
  SELECT v_hold.wallet_id, v_receiver_wallet, v_hold.sprayer_id, v_host, w.currency, v_hold.planned_amount_kobo, 0,
         'completed', v_sender_txn_id, v_receiver_txn_id, 'Spray at event ' || v_hold.event_id::text
    FROM public.wallets w WHERE w.id = v_hold.wallet_id
  RETURNING id INTO v_transfer_id;

  INSERT INTO public.spray_records (event_id, sprayer_id, receiver_id, transaction_id, amount, denomination, note_count, metadata)
  VALUES (v_hold.event_id, v_hold.sprayer_id, v_host, v_sender_txn_id, v_hold.planned_amount_kobo, v_hold.denomination,
          v_hold.note_count, COALESCE(v_metadata, '{}'::jsonb));

  UPDATE public.spray_holds
     SET charged_amount_kobo = v_hold.planned_amount_kobo, settlement_type = 'full', transfer_id = v_transfer_id
   WHERE id = p_hold_id;
END;
$$;

-- Ends a charged turn: no money moves (it moved on the way in).
CREATE OR REPLACE FUNCTION public._finish_floor_turn(p_hold_id uuid, p_release_reason text DEFAULT NULL)
RETURNS void LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
BEGIN
  UPDATE public.spray_holds
     SET status = 'settled', settled_at = now(), release_reason = p_release_reason
   WHERE id = p_hold_id AND status = 'on_floor' AND transfer_id IS NOT NULL;
END;
$$;

-- Charge on promotion without letting one bad row block the floor: on failure the charge rolls back to
-- the savepoint, the hold is released at no charge ('charge_failed', lock returned), and the slot frees.
CREATE OR REPLACE FUNCTION public._floor_try_charge(p_hold_id uuid)
RETURNS boolean LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
BEGIN
  BEGIN
    PERFORM public._charge_floor_hold(p_hold_id);
    RETURN true;
  EXCEPTION WHEN others THEN
    RAISE WARNING 'floor charge failed for hold %: %', p_hold_id, SQLERRM;
  END;
  PERFORM public._settle_floor_hold(p_hold_id, 0, 'charge_failed');
  RETURN false;
END;
$$;

-- 088's settle, refusing a hold that was already charged on the way in (never charge twice).
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
  IF p_charged_kobo IS NULL OR p_charged_kobo < 0 OR p_charged_kobo > v_hold.planned_amount_kobo
     OR p_charged_kobo % (v_hold.denomination * 100) <> 0 THEN
    RAISE EXCEPTION 'Invalid floor charge';
  END IF;
  IF v_hold.transfer_id IS NOT NULL THEN RAISE EXCEPTION 'Floor spray already charged'; END IF;
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

-- Stop is retired: a spray always runs its turn (it was paid in full on the way in).
CREATE OR REPLACE FUNCTION public.stop_floor_spray(p_hold_id uuid, p_sprayer_id uuid)
RETURNS uuid LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
BEGIN
  RAISE EXCEPTION 'Sprays can''t be stopped once they start';
END;
$$;

-- 088's advance: charged holds finish without money; promotion charges in full (failure releases the
-- hold and the slot goes to the next person); legacy uncharged holds keep the time-based settle.
CREATE OR REPLACE FUNCTION public.advance_event_floor(p_event_id uuid)
RETURNS boolean LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
DECLARE
  v_status public.event_status;
  v_ended_at timestamptz;
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

  SELECT status, ended_at INTO v_status, v_ended_at FROM public.events WHERE id = p_event_id;

  IF v_status IS DISTINCT FROM 'live' THEN
    FOR r IN SELECT id, note_count, denomination, floor_seconds, floor_started_at, transfer_id
               FROM public.spray_holds WHERE event_id = p_event_id AND status = 'on_floor' LOOP
      IF r.transfer_id IS NOT NULL THEN
        PERFORM public._finish_floor_turn(r.id, 'event_ended_on_floor');
      ELSE
        -- Legacy hold: charge only up to the moment the event ended, however late this runs.
        PERFORM public._floor_try_settle(r.id,
          public.floor_charged_kobo(r.note_count, r.denomination, r.floor_seconds,
            floor(extract(epoch FROM (LEAST(now(), COALESCE(v_ended_at, now())) - r.floor_started_at)) * 1000)::bigint),
          'event_ended_on_floor');
      END IF;
    END LOOP;
    FOR r IN SELECT id FROM public.spray_holds WHERE event_id = p_event_id AND status = 'queued' LOOP
      PERFORM public._floor_try_settle(r.id, 0, 'event_ended');
    END LOOP;
    PERFORM public._floor_ping(p_event_id);
    RETURN true;
  END IF;

  v_settings := public.floor_settings();

  FOR r IN SELECT id, planned_amount_kobo, transfer_id FROM public.spray_holds
            WHERE event_id = p_event_id AND status = 'on_floor' AND floor_ends_at <= now() LOOP
    IF r.transfer_id IS NOT NULL THEN
      PERFORM public._finish_floor_turn(r.id);
      v_changed := true;
    ELSIF public._floor_try_settle(r.id, r.planned_amount_kobo) THEN
      v_changed := true;
    END IF;
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
    -- Paid in full on stepping on. A failure releases the hold and frees the slot for the next loop.
    PERFORM public._floor_try_charge(r.id);
    v_changed := true;
  END LOOP;

  IF v_changed THEN PERFORM public._floor_ping(p_event_id); END IF;
  RETURN v_changed;
END;
$$;

-- 100's removal: a charged hold just ends its turn (already paid, no refund); legacy holds keep the
-- time-based charge; queued holds are released free.
CREATE OR REPLACE FUNCTION public.admin_remove_floor_hold(p_event_id uuid, p_hold_id uuid, p_admin_auth_id uuid, p_reason text)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_hold public.spray_holds%ROWTYPE;
  v_reason text := btrim(COALESCE(p_reason, ''));
  v_charged bigint := 0;
  v_paid boolean := false;
  v_title text;
  v_event_status text;
  v_body text;
BEGIN
  SELECT * INTO v_hold FROM public.spray_holds WHERE id = p_hold_id FOR UPDATE;
  IF NOT FOUND THEN RAISE EXCEPTION 'Spray hold not found'; END IF;
  -- Never act on another event's floor through this event.
  IF v_hold.event_id <> p_event_id THEN RAISE EXCEPTION 'Spray hold not found in this event'; END IF;
  -- An ended event's floor settles automatically.
  SELECT status::text, title INTO v_event_status, v_title FROM public.events WHERE id = v_hold.event_id;
  IF v_event_status IS DISTINCT FROM 'live' THEN
    RAISE EXCEPTION 'The event has ended; its floor settles automatically';
  END IF;
  IF v_hold.status NOT IN ('queued', 'on_floor') THEN
    RAISE EXCEPTION 'This spray isn''t on the floor or in the queue';
  END IF;
  IF v_reason = '' THEN RAISE EXCEPTION 'A reason is required'; END IF;
  IF length(v_reason) > 500 THEN RAISE EXCEPTION 'Keep the reason under 500 characters'; END IF;

  IF v_hold.status = 'queued' THEN
    PERFORM public._settle_floor_hold(p_hold_id, 0, 'removed_by_admin');
  ELSIF v_hold.transfer_id IS NOT NULL THEN
    -- Paid in full on stepping on: ending the turn moves no money.
    v_paid := true;
    v_charged := v_hold.charged_amount_kobo;
    PERFORM public._finish_floor_turn(p_hold_id, 'removed_by_admin');
  ELSE
    -- Legacy hold: exactly what Stop used to charge, the notes for the time danced, paid to the host.
    v_charged := public.floor_charged_kobo(v_hold.note_count, v_hold.denomination, v_hold.floor_seconds,
                                           public._floor_elapsed_ms(v_hold.floor_started_at));
    PERFORM public._settle_floor_hold(p_hold_id, v_charged, 'removed_by_admin');
    UPDATE public.spray_holds SET release_reason = 'removed_by_admin' WHERE id = p_hold_id;
  END IF;

  PERFORM public.advance_event_floor(v_hold.event_id);
  PERFORM public._floor_ping(v_hold.event_id);

  v_body := format('You were removed from the dance floor at "%s": %s', v_title, v_reason)
    || CASE WHEN right(v_reason, 1) IN ('.', '!', '?') THEN '' ELSE '.' END
    || CASE
         WHEN v_paid THEN format(' Your ₦%s spray had already gone to the host.', btrim(to_char(v_charged / 100.0, 'FM999G999G990D00')))
         WHEN v_charged > 0 THEN format(' You were charged ₦%s for the time you danced.', btrim(to_char(v_charged / 100.0, 'FM999G999G990D00')))
         ELSE ' You weren''t charged.' END;
  PERFORM public.create_notification(v_hold.sprayer_id, 'floor_removed', 'Removed from the dance floor', v_body,
    jsonb_build_object('event_id', v_hold.event_id, 'hold_id', p_hold_id, 'charged_kobo', v_charged, 'already_paid', v_paid));

  PERFORM public.log_admin_action(p_admin_auth_id, 'remove_floor_hold', 'spray_hold', p_hold_id,
    jsonb_build_object('reason', v_reason, 'event_id', v_hold.event_id, 'sprayer_id', v_hold.sprayer_id,
                       'was_status', v_hold.status::text, 'charged_kobo', v_charged, 'already_paid', v_paid));

  RETURN jsonb_build_object('hold_id', p_hold_id, 'event_id', v_hold.event_id,
                            'was_status', v_hold.status::text, 'charged_kobo', v_charged, 'already_paid', v_paid);
END;
$$;

REVOKE ALL ON FUNCTION public._charge_floor_hold(uuid) FROM PUBLIC, anon, authenticated;
REVOKE ALL ON FUNCTION public._finish_floor_turn(uuid, text) FROM PUBLIC, anon, authenticated;
REVOKE ALL ON FUNCTION public._floor_try_charge(uuid) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public._charge_floor_hold(uuid) TO service_role;
GRANT EXECUTE ON FUNCTION public._finish_floor_turn(uuid, text) TO service_role;
GRANT EXECUTE ON FUNCTION public._floor_try_charge(uuid) TO service_role;
-- Replaced functions keep their grants (CREATE OR REPLACE), re-asserted here for clarity.
REVOKE ALL ON FUNCTION public._settle_floor_hold(uuid, bigint, text) FROM PUBLIC, anon, authenticated;
REVOKE ALL ON FUNCTION public.stop_floor_spray(uuid, uuid) FROM PUBLIC, anon, authenticated;
REVOKE ALL ON FUNCTION public.advance_event_floor(uuid) FROM PUBLIC, anon, authenticated;
REVOKE ALL ON FUNCTION public.admin_remove_floor_hold(uuid, uuid, uuid, text) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public._settle_floor_hold(uuid, bigint, text) TO service_role;
GRANT EXECUTE ON FUNCTION public.stop_floor_spray(uuid, uuid) TO service_role;
GRANT EXECUTE ON FUNCTION public.advance_event_floor(uuid) TO service_role;
GRANT EXECUTE ON FUNCTION public.admin_remove_floor_hold(uuid, uuid, uuid, text) TO service_role;
