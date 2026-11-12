-- 105: (1) users.gender, which picks a guest's stand-in dancer; (2) the host can call a guest up directly.
--
-- BEFORE APPLYING: three functions below are re-created from their last definitions with one change each.
-- Diff each against the live definition first and rebase this file if the live one differs beyond the
-- marked line:
--   pg_get_functiondef('public.get_event_floor(uuid)'::regprocedure)   -- from 102, adds 'standin'
--   pg_get_functiondef('public.get_call_ups(uuid)'::regprocedure)      -- from 104, throttle counts guest requests only
--   pg_get_functiondef('public.request_call_up(uuid)'::regprocedure)   -- from 104, same

-- ── 1. Gender ──────────────────────────────────────────────────────────────────────────────────
-- Nullable: people who signed up before this keep a stand-in picked by hash until they choose.
ALTER TABLE public.users ADD COLUMN gender text CHECK (gender IN ('male', 'female'));

-- Users edit their own row through column grants (074); gender joins full_name / avatar_url / avatar_data.
GRANT UPDATE (gender) ON public.users TO authenticated;

-- One change to get_event_floor: each dancer carries 'standin' ('m' / 'f' / null). The floor feed is public
-- (projector), so it says which stand-in to draw, not the person's gender as such.
CREATE OR REPLACE FUNCTION public.get_event_floor(p_event_id uuid)
RETURNS jsonb LANGUAGE plpgsql VOLATILE SECURITY DEFINER SET search_path = public AS $$
DECLARE
  v_event RECORD;
  v_me uuid;
  v_settings jsonb;
  v_floor jsonb;
  v_waiting int;
  v_my RECORD;
  v_me_json jsonb := NULL;
  v_pos int;
  v_eta int;
BEGIN
  SELECT id, host_id, is_private INTO v_event FROM public.events WHERE id = p_event_id;
  IF NOT FOUND THEN RAISE EXCEPTION 'Event not found'; END IF;

  SELECT id INTO v_me FROM public.users WHERE auth_id = auth.uid();
  IF v_event.is_private AND NOT (
       v_me IS NOT NULL AND (v_me = v_event.host_id OR EXISTS (
         SELECT 1 FROM public.event_participants WHERE event_id = p_event_id AND user_id = v_me))) THEN
    RAISE EXCEPTION 'Not authorized';
  END IF;

  PERFORM public.advance_event_floor(p_event_id);
  v_settings := public.floor_settings();

  SELECT COALESCE(jsonb_agg(jsonb_build_object(
           'hold_id', sh.id, 'slot', sh.floor_slot,
           'name', COALESCE(NULLIF(trim(u.full_name), ''), '@' || NULLIF(trim(u.username), ''), 'Guest'),
           'username', NULLIF(trim(u.username), ''),
           'standin', CASE u.gender WHEN 'male' THEN 'm' WHEN 'female' THEN 'f' END,
           'avatar_url', u.avatar_url, 'amount_kobo', sh.planned_amount_kobo,
           'denomination', sh.denomination, 'note_count', sh.note_count,
           'started_at', sh.floor_started_at, 'ends_at', sh.floor_ends_at,
           'floor_seconds', sh.floor_seconds, 'is_me', sh.sprayer_id IS NOT DISTINCT FROM v_me,
           'model_path', public._floor_model_path(u.auth_id, u.avatar_data->'floorVersion'),
           'moves', public._floor_moves(u.avatar_data->'danceMoves'))
         ORDER BY sh.floor_slot), '[]'::jsonb)
    INTO v_floor
    FROM public.spray_holds sh JOIN public.users u ON u.id = sh.sprayer_id
   WHERE sh.event_id = p_event_id AND sh.status = 'on_floor';

  SELECT count(*) INTO v_waiting FROM public.spray_holds WHERE event_id = p_event_id AND status = 'queued';

  IF v_me IS NOT NULL THEN
    SELECT * INTO v_my FROM public.spray_holds
     WHERE event_id = p_event_id AND sprayer_id = v_me AND queued_at IS NOT NULL
       AND (status IN ('queued', 'on_floor') OR settled_at > now() - interval '2 minutes')
     ORDER BY queued_at DESC LIMIT 1;
    IF FOUND THEN
      IF v_my.status = 'queued' THEN
        SELECT count(*) + 1 INTO v_pos FROM public.spray_holds
         WHERE event_id = p_event_id AND status = 'queued' AND (queued_at, id) < (v_my.queued_at, v_my.id);
        v_eta := public.floor_eta_seconds(p_event_id, v_pos);
      END IF;
      v_me_json := jsonb_build_object(
        'hold_id', v_my.id, 'status', v_my.status, 'amount_kobo', v_my.planned_amount_kobo,
        'position', v_pos, 'eta_seconds', v_eta, 'charged_kobo', v_my.charged_amount_kobo,
        'release_reason', v_my.release_reason);
    END IF;
  END IF;

  RETURN jsonb_build_object(
    'server_now', clock_timestamp(),
    'floor', v_floor,
    'waiting_count', v_waiting,
    'next_eta_seconds', public.floor_eta_seconds(p_event_id, v_waiting + 1),
    'bands', v_settings->'bands',
    'busy', jsonb_build_object('threshold', (v_settings->>'busy_threshold')::int,
                               'shrink_pct', (v_settings->>'busy_shrink_pct')::int,
                               'min_seconds', (v_settings->>'min_seconds')::int),
    'me', v_me_json);
END;
$$;

REVOKE ALL ON FUNCTION public.get_event_floor(uuid) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.get_event_floor(uuid) TO anon, authenticated, service_role;

-- ── 2. Host calls a guest up ───────────────────────────────────────────────────────────────────
-- Who started the row. Only a guest's own requests count toward their request throttle.
ALTER TABLE public.event_call_ups
  ADD COLUMN initiated_by text NOT NULL DEFAULT 'guest' CHECK (initiated_by IN ('guest', 'host'));

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
             'call_up_id', c.id, 'id', u.id,
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
         WHERE event_id = p_event_id AND guest_id = v_me AND initiated_by = 'guest'
           AND requested_at > now() - interval '5 minutes';
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
  -- A verified email is compulsory: crediting a wallet needs it, so an unverified guest could never be paid.
  IF COALESCE((SELECT kyc_level FROM public.users WHERE id = v_me), 0) < 1 THEN RAISE EXCEPTION 'CALLUP_NOT_VERIFIED'; END IF;

  -- One request at a time per guest and event, so double taps and the throttle count are exact.
  PERFORM pg_advisory_xact_lock(hashtextextended(p_event_id::text || v_me::text, 0));

  IF EXISTS (SELECT 1 FROM public.event_call_ups
              WHERE event_id = p_event_id AND guest_id = v_me AND status IN ('pending', 'accepted')) THEN
    RETURN public.get_call_ups(p_event_id);
  END IF;

  SELECT count(*) INTO v_n FROM public.event_call_ups
   WHERE event_id = p_event_id AND guest_id = v_me AND initiated_by = 'guest'
     AND requested_at > now() - interval '5 minutes';
  IF v_n >= 3 THEN RAISE EXCEPTION 'CALLUP_THROTTLED'; END IF;

  INSERT INTO public.event_call_ups (event_id, guest_id) VALUES (p_event_id, v_me);
  RETURN public.get_call_ups(p_event_id);
END;
$$;

-- Host only: joined guests who can still be called up (not the host, no open call-up), for the picker.
-- 'verified' = has a verified email; an unverified guest is listed but cannot be called up.
CREATE OR REPLACE FUNCTION public.list_call_up_candidates(p_event_id uuid, p_search text DEFAULT NULL) RETURNS jsonb
LANGUAGE plpgsql STABLE SECURITY DEFINER SET search_path = public AS $$
DECLARE
  v_host uuid;
  v_q text := NULLIF(lower(left(trim(COALESCE(p_search, '')), 50)), '');
  v_out jsonb;
BEGIN
  SELECT host_id INTO v_host FROM public.events WHERE id = p_event_id;
  IF NOT FOUND THEN RAISE EXCEPTION 'Event not found'; END IF;
  IF v_host IS DISTINCT FROM public._call_up_user() THEN RAISE EXCEPTION 'CALLUP_NOT_HOST'; END IF;

  SELECT COALESCE(jsonb_agg(jsonb_build_object(
           'id', c.id, 'name', c.name, 'username', c.username, 'avatar_url', c.avatar_url, 'verified', c.verified)
           ORDER BY lower(c.name), c.id), '[]'::jsonb)
    INTO v_out
    FROM (
      SELECT u.id,
             COALESCE(NULLIF(trim(u.full_name), ''), NULLIF(trim(u.username), ''), 'Guest') AS name,
             u.username, u.avatar_url, COALESCE(u.kyc_level, 0) >= 1 AS verified
        FROM public.event_participants p JOIN public.users u ON u.id = p.user_id
       WHERE p.event_id = p_event_id AND u.id <> v_host
         AND NOT EXISTS (SELECT 1 FROM public.event_call_ups c
                          WHERE c.event_id = p_event_id AND c.guest_id = u.id AND c.status IN ('pending', 'accepted'))
         -- position(), not LIKE: the search text is never a pattern
         AND (v_q IS NULL OR position(v_q IN lower(COALESCE(u.full_name, ''))) > 0
                          OR position(v_q IN lower(COALESCE(u.username, ''))) > 0)
       ORDER BY lower(COALESCE(NULLIF(trim(u.full_name), ''), NULLIF(trim(u.username), ''), 'Guest')), u.id
       LIMIT 50
    ) c;
  RETURN v_out;
END;
$$;

-- Host only: call a joined guest up without a request. A waiting request is accepted instead of duplicated.
CREATE OR REPLACE FUNCTION public.host_call_up(p_event_id uuid, p_guest_id uuid) RETURNS jsonb
LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
DECLARE v_host uuid; v_status public.event_status;
BEGIN
  SELECT host_id, status INTO v_host, v_status FROM public.events WHERE id = p_event_id;
  IF NOT FOUND THEN RAISE EXCEPTION 'Event not found'; END IF;
  IF v_host IS DISTINCT FROM public._call_up_user() THEN RAISE EXCEPTION 'CALLUP_NOT_HOST'; END IF;
  IF v_status <> 'live' THEN RAISE EXCEPTION 'CALLUP_NOT_LIVE'; END IF;
  IF p_guest_id = v_host THEN RAISE EXCEPTION 'CALLUP_HOST'; END IF;
  IF NOT EXISTS (SELECT 1 FROM public.event_participants WHERE event_id = p_event_id AND user_id = p_guest_id) THEN
    RAISE EXCEPTION 'CALLUP_NOT_JOINED';
  END IF;
  -- Same rule as a request: crediting a wallet needs a verified email.
  IF COALESCE((SELECT kyc_level FROM public.users WHERE id = p_guest_id), 0) < 1 THEN RAISE EXCEPTION 'CALLUP_NOT_VERIFIED'; END IF;

  -- The lock request_call_up takes for this guest and event: the two can't both insert an open row.
  PERFORM pg_advisory_xact_lock(hashtextextended(p_event_id::text || p_guest_id::text, 0));

  UPDATE public.event_call_ups SET status = 'accepted', responded_at = now()
   WHERE event_id = p_event_id AND guest_id = p_guest_id AND status = 'pending';
  IF NOT FOUND AND NOT EXISTS (SELECT 1 FROM public.event_call_ups
                                WHERE event_id = p_event_id AND guest_id = p_guest_id AND status = 'accepted') THEN
    INSERT INTO public.event_call_ups (event_id, guest_id, status, responded_at, initiated_by)
    VALUES (p_event_id, p_guest_id, 'accepted', now(), 'host');
  END IF;
  RETURN public.get_call_ups(p_event_id);
END;
$$;

REVOKE ALL ON FUNCTION public.get_call_ups(uuid) FROM PUBLIC, anon;
REVOKE ALL ON FUNCTION public.request_call_up(uuid) FROM PUBLIC, anon;
REVOKE ALL ON FUNCTION public.list_call_up_candidates(uuid, text) FROM PUBLIC, anon;
REVOKE ALL ON FUNCTION public.host_call_up(uuid, uuid) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.get_call_ups(uuid) TO authenticated;
GRANT EXECUTE ON FUNCTION public.request_call_up(uuid) TO authenticated;
GRANT EXECUTE ON FUNCTION public.list_call_up_candidates(uuid, text) TO authenticated;
GRANT EXECUTE ON FUNCTION public.host_call_up(uuid, uuid) TO authenticated;
