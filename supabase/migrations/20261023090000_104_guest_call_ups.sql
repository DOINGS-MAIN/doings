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
