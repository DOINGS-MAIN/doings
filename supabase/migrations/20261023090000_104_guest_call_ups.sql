-- 104: guest call-ups. A joined guest asks the host to be called up; the host accepts; accepted guests can
-- be chosen as the recipient of a spray (part 2 below). Requests are throttled: 3 per guest per event in
-- 5 minutes, then refused until 5 minutes after the latest one.

CREATE TABLE public.event_call_ups (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  event_id uuid NOT NULL REFERENCES public.events(id) ON DELETE CASCADE,
  guest_id uuid NOT NULL REFERENCES public.users(id),
  status text NOT NULL DEFAULT 'pending'
    CHECK (status IN ('pending', 'accepted', 'declined', 'removed', 'cancelled')),
  requested_at timestamptz NOT NULL DEFAULT now(),
  responded_at timestamptz,
  removed_by text CHECK (removed_by IN ('host', 'guest'))
);

-- One open (pending or accepted) row per guest per event.
CREATE UNIQUE INDEX uq_call_ups_open ON public.event_call_ups (event_id, guest_id) WHERE status IN ('pending', 'accepted');
CREATE INDEX idx_call_ups_event_status ON public.event_call_ups (event_id, status);
CREATE INDEX idx_call_ups_guest_requested ON public.event_call_ups (event_id, guest_id, requested_at DESC);

-- Reached only through the functions below.
ALTER TABLE public.event_call_ups ENABLE ROW LEVEL SECURITY;

CREATE OR REPLACE FUNCTION public._call_up_user() RETURNS uuid
LANGUAGE sql STABLE SECURITY DEFINER SET search_path = public AS $$
  SELECT id FROM public.users WHERE auth_id = auth.uid()
$$;

-- What the caller may see: their own state (with any cooldown), the called-up guests, and (host only) the requests.
CREATE OR REPLACE FUNCTION public.get_call_ups(p_event_id uuid) RETURNS jsonb
LANGUAGE plpgsql STABLE SECURITY DEFINER SET search_path = public AS $$
DECLARE
  v_me uuid := public._call_up_user();
  v_event RECORD;
  v_member boolean;
  v_status text := 'none';
  v_retry int := 0;
  v_n int;
  v_last timestamptz;
  v_called jsonb := '[]'::jsonb;
  v_pending jsonb := '[]'::jsonb;
BEGIN
  SELECT id, host_id INTO v_event FROM public.events WHERE id = p_event_id;
  IF NOT FOUND THEN RAISE EXCEPTION 'Event not found'; END IF;
  v_member := v_me IS NOT NULL AND (v_event.host_id = v_me
    OR EXISTS (SELECT 1 FROM public.event_participants WHERE event_id = p_event_id AND user_id = v_me));

  IF v_member THEN
    SELECT COALESCE(jsonb_agg(jsonb_build_object(
             'id', u.id,
             'name', COALESCE(NULLIF(trim(u.full_name), ''), NULLIF(trim(u.username), ''), 'Guest'),
             'username', u.username, 'avatar_url', u.avatar_url) ORDER BY c.responded_at), '[]'::jsonb)
      INTO v_called
      FROM public.event_call_ups c JOIN public.users u ON u.id = c.guest_id
     WHERE c.event_id = p_event_id AND c.status = 'accepted';

    IF v_event.host_id = v_me THEN
      SELECT COALESCE(jsonb_agg(jsonb_build_object(
               'call_up_id', c.id, 'id', u.id,
               'name', COALESCE(NULLIF(trim(u.full_name), ''), NULLIF(trim(u.username), ''), 'Guest'),
               'username', u.username, 'avatar_url', u.avatar_url) ORDER BY c.requested_at), '[]'::jsonb)
        INTO v_pending
        FROM public.event_call_ups c JOIN public.users u ON u.id = c.guest_id
       WHERE c.event_id = p_event_id AND c.status = 'pending';
    ELSE
      SELECT status INTO v_status FROM public.event_call_ups
       WHERE event_id = p_event_id AND guest_id = v_me AND status IN ('pending', 'accepted');
      v_status := COALESCE(v_status, 'none');
      IF v_status = 'none' THEN
        SELECT count(*), max(requested_at) INTO v_n, v_last FROM public.event_call_ups
         WHERE event_id = p_event_id AND guest_id = v_me AND requested_at > now() - interval '5 minutes';
        IF v_n >= 3 THEN
          v_retry := GREATEST(ceil(extract(epoch FROM (v_last + interval '5 minutes' - now())))::int, 0);
        END IF;
      END IF;
    END IF;
  END IF;

  RETURN jsonb_build_object(
    'server_now', to_jsonb(now()),
    'me', jsonb_build_object('status', v_status, 'retry_after_seconds', v_retry),
    'called_up', v_called,
    'pending', v_pending);
END;
$$;

CREATE OR REPLACE FUNCTION public.request_call_up(p_event_id uuid) RETURNS jsonb
LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
DECLARE
  v_me uuid := public._call_up_user();
  v_event RECORD;
  v_n int;
BEGIN
  IF v_me IS NULL THEN RAISE EXCEPTION 'Not authenticated'; END IF;
  SELECT id, host_id, status INTO v_event FROM public.events WHERE id = p_event_id;
  IF NOT FOUND THEN RAISE EXCEPTION 'Event not found'; END IF;
  IF v_event.host_id = v_me THEN RAISE EXCEPTION 'CALLUP_HOST'; END IF;
  IF v_event.status <> 'live' THEN RAISE EXCEPTION 'CALLUP_NOT_LIVE'; END IF;
  IF NOT EXISTS (SELECT 1 FROM public.event_participants WHERE event_id = p_event_id AND user_id = v_me) THEN
    RAISE EXCEPTION 'CALLUP_NOT_JOINED';
  END IF;

  -- One request at a time per guest and event, so double taps and the throttle count are exact.
  PERFORM pg_advisory_xact_lock(hashtextextended(p_event_id::text || v_me::text, 0));

  IF EXISTS (SELECT 1 FROM public.event_call_ups
              WHERE event_id = p_event_id AND guest_id = v_me AND status IN ('pending', 'accepted')) THEN
    RETURN public.get_call_ups(p_event_id);
  END IF;

  SELECT count(*) INTO v_n FROM public.event_call_ups
   WHERE event_id = p_event_id AND guest_id = v_me AND requested_at > now() - interval '5 minutes';
  IF v_n >= 3 THEN RAISE EXCEPTION 'CALLUP_THROTTLED'; END IF;

  INSERT INTO public.event_call_ups (event_id, guest_id) VALUES (p_event_id, v_me);
  RETURN public.get_call_ups(p_event_id);
END;
$$;

-- Withdraws a pending request, or (accepted) steps the caller down.
CREATE OR REPLACE FUNCTION public.cancel_call_up(p_event_id uuid) RETURNS jsonb
LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
DECLARE v_me uuid := public._call_up_user();
BEGIN
  IF v_me IS NULL THEN RAISE EXCEPTION 'Not authenticated'; END IF;
  PERFORM pg_advisory_xact_lock(hashtextextended(p_event_id::text || v_me::text, 0));
  UPDATE public.event_call_ups
     SET status = CASE status WHEN 'pending' THEN 'cancelled' ELSE 'removed' END,
         removed_by = CASE status WHEN 'accepted' THEN 'guest' ELSE NULL END,
         responded_at = now()
   WHERE event_id = p_event_id AND guest_id = v_me AND status IN ('pending', 'accepted');
  RETURN public.get_call_ups(p_event_id);
END;
$$;

CREATE OR REPLACE FUNCTION public._call_up_host_event(p_call_up_id uuid) RETURNS uuid
LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
DECLARE v_event uuid; v_host uuid;
BEGIN
  SELECT c.event_id, e.host_id INTO v_event, v_host
    FROM public.event_call_ups c JOIN public.events e ON e.id = c.event_id WHERE c.id = p_call_up_id;
  IF NOT FOUND THEN RAISE EXCEPTION 'Call-up not found'; END IF;
  IF v_host IS DISTINCT FROM public._call_up_user() THEN RAISE EXCEPTION 'CALLUP_NOT_HOST'; END IF;
  RETURN v_event;
END;
$$;

CREATE OR REPLACE FUNCTION public.respond_call_up(p_call_up_id uuid, p_accept boolean) RETURNS jsonb
LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
DECLARE v_event uuid := public._call_up_host_event(p_call_up_id);
BEGIN
  IF (SELECT status FROM public.events WHERE id = v_event) <> 'live' THEN RAISE EXCEPTION 'CALLUP_NOT_LIVE'; END IF;
  UPDATE public.event_call_ups
     SET status = CASE WHEN p_accept THEN 'accepted' ELSE 'declined' END, responded_at = now()
   WHERE id = p_call_up_id AND status = 'pending';
  RETURN public.get_call_ups(v_event);
END;
$$;

CREATE OR REPLACE FUNCTION public.remove_call_up(p_call_up_id uuid) RETURNS jsonb
LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
DECLARE v_event uuid := public._call_up_host_event(p_call_up_id);
BEGIN
  UPDATE public.event_call_ups SET status = 'removed', removed_by = 'host', responded_at = now()
   WHERE id = p_call_up_id AND status = 'accepted';
  RETURN public.get_call_ups(v_event);
END;
$$;

CREATE OR REPLACE FUNCTION public.accept_all_call_ups(p_event_id uuid) RETURNS jsonb
LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
DECLARE v_host uuid; v_status public.event_status; v_n int;
BEGIN
  SELECT host_id, status INTO v_host, v_status FROM public.events WHERE id = p_event_id;
  IF NOT FOUND THEN RAISE EXCEPTION 'Event not found'; END IF;
  IF v_host IS DISTINCT FROM public._call_up_user() THEN RAISE EXCEPTION 'CALLUP_NOT_HOST'; END IF;
  IF v_status <> 'live' THEN RAISE EXCEPTION 'CALLUP_NOT_LIVE'; END IF;
  UPDATE public.event_call_ups SET status = 'accepted', responded_at = now()
   WHERE event_id = p_event_id AND status = 'pending';
  GET DIAGNOSTICS v_n = ROW_COUNT;
  RETURN to_jsonb(v_n);
END;
$$;

REVOKE ALL ON FUNCTION public._call_up_user() FROM PUBLIC, anon, authenticated;
REVOKE ALL ON FUNCTION public._call_up_host_event(uuid) FROM PUBLIC, anon, authenticated;
REVOKE ALL ON FUNCTION public.get_call_ups(uuid) FROM PUBLIC, anon;
REVOKE ALL ON FUNCTION public.request_call_up(uuid) FROM PUBLIC, anon;
REVOKE ALL ON FUNCTION public.cancel_call_up(uuid) FROM PUBLIC, anon;
REVOKE ALL ON FUNCTION public.respond_call_up(uuid, boolean) FROM PUBLIC, anon;
REVOKE ALL ON FUNCTION public.remove_call_up(uuid) FROM PUBLIC, anon;
REVOKE ALL ON FUNCTION public.accept_all_call_ups(uuid) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.get_call_ups(uuid) TO authenticated;
GRANT EXECUTE ON FUNCTION public.request_call_up(uuid) TO authenticated;
GRANT EXECUTE ON FUNCTION public.cancel_call_up(uuid) TO authenticated;
GRANT EXECUTE ON FUNCTION public.respond_call_up(uuid, boolean) TO authenticated;
GRANT EXECUTE ON FUNCTION public.remove_call_up(uuid) TO authenticated;
GRANT EXECUTE ON FUNCTION public.accept_all_call_ups(uuid) TO authenticated;


-- ── Part 2: the recipient of a floor spray ──
ALTER TABLE public.spray_holds ADD COLUMN IF NOT EXISTS recipient_id uuid REFERENCES public.users(id);
COMMENT ON COLUMN public.spray_holds.recipient_id IS 'Called-up guest who receives the spray; NULL = the event host.';

DROP FUNCTION IF EXISTS public.queue_floor_spray(uuid, uuid, bigint, int, int);

CREATE OR REPLACE FUNCTION public.queue_floor_spray(
  p_event_id uuid, p_sprayer_id uuid, p_amount_kobo bigint, p_denomination int, p_note_count int,
  p_recipient_id uuid DEFAULT NULL)
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

  -- The recipient is the called-up guest chosen at PIN, else the host (also for holds from before 104).
  SELECT COALESCE(v_hold.recipient_id, host_id) INTO v_host FROM public.events WHERE id = v_hold.event_id;
  SELECT id INTO v_receiver_wallet FROM public.wallets WHERE user_id = v_host AND currency = 'NGN';
  IF v_receiver_wallet IS NULL THEN RAISE EXCEPTION 'Receiver wallet not found'; END IF;

  v_idem_key := 'spray-hold-' || p_hold_id::text;
  v_metadata := v_hold.metadata || jsonb_build_object(
    'hold_id', p_hold_id, 'recipient_id', v_host, 'settlement', 'full', 'floor', true, 'charged_at', 'floor_entry',
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

  -- The recipient is the called-up guest chosen at PIN, else the host (also for holds from before 104).
  SELECT COALESCE(v_hold.recipient_id, host_id) INTO v_host FROM public.events WHERE id = v_hold.event_id;
  SELECT id INTO v_receiver_wallet FROM public.wallets WHERE user_id = v_host AND currency = 'NGN';
  IF v_receiver_wallet IS NULL THEN RAISE EXCEPTION 'Receiver wallet not found'; END IF;

  v_settlement := CASE WHEN p_charged_kobo = v_hold.planned_amount_kobo THEN 'full' ELSE 'partial' END;
  v_note_count := p_charged_kobo / (v_hold.denomination * 100);
  v_idem_key := 'spray-hold-' || p_hold_id::text;
  v_metadata := v_hold.metadata || jsonb_build_object(
    'hold_id', p_hold_id, 'recipient_id', v_host, 'settlement', v_settlement::text, 'floor', true,
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

REVOKE ALL ON FUNCTION public.queue_floor_spray(uuid, uuid, bigint, int, int, uuid) FROM PUBLIC, anon, authenticated;
