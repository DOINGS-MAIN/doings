-- Migration 100: admin control of a live dance floor. Moderation can remove one spray from the floor
-- or the queue — queued: released with no charge (like leaving); on the floor: settled like Stop
-- (charged only for the time danced, paid to the host) — and support/moderation can advance a stuck
-- floor. Both are service_role only and called only by the admin edge function.

-- release_reason gains 'removed_by_admin' (the 088 inline CHECK has a generated name).
DO $$
DECLARE c text;
BEGIN
  FOR c IN
    SELECT con.conname FROM pg_constraint con
    JOIN pg_attribute att ON att.attrelid = con.conrelid AND att.attnum = ANY (con.conkey)
    WHERE con.conrelid = 'public.spray_holds'::regclass AND con.contype = 'c' AND att.attname = 'release_reason'
  LOOP
    EXECUTE format('ALTER TABLE public.spray_holds DROP CONSTRAINT %I', c);
  END LOOP;
END $$;
-- NOT VALID then VALIDATE: checking existing rows doesn't hold an exclusive lock on this live table.
ALTER TABLE public.spray_holds ADD CONSTRAINT ck_spray_hold_release_reason
  CHECK (release_reason IN ('left', 'max_wait', 'event_ended', 'event_ended_on_floor', 'removed_by_admin')) NOT VALID;
ALTER TABLE public.spray_holds VALIDATE CONSTRAINT ck_spray_hold_release_reason;

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
  v_title text;
  v_event_status text;
  v_body text;
BEGIN
  SELECT * INTO v_hold FROM public.spray_holds WHERE id = p_hold_id FOR UPDATE;
  IF NOT FOUND THEN RAISE EXCEPTION 'Spray hold not found'; END IF;
  -- Never act on another event's floor through this event.
  IF v_hold.event_id <> p_event_id THEN RAISE EXCEPTION 'Spray hold not found in this event'; END IF;
  -- An ended event's floor settles automatically, charged only up to its end time.
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
  ELSE
    -- Exactly what Stop charges: the notes for the time actually danced, paid to the host.
    v_charged := public.floor_charged_kobo(v_hold.note_count, v_hold.denomination, v_hold.floor_seconds,
                                           public._floor_elapsed_ms(v_hold.floor_started_at));
    PERFORM public._settle_floor_hold(p_hold_id, v_charged, 'removed_by_admin');
    UPDATE public.spray_holds SET release_reason = 'removed_by_admin' WHERE id = p_hold_id;
  END IF;

  PERFORM public.advance_event_floor(v_hold.event_id);
  PERFORM public._floor_ping(v_hold.event_id);

  v_body := format('You were removed from the dance floor at "%s": %s', v_title, v_reason)
    || CASE WHEN right(v_reason, 1) IN ('.', '!', '?') THEN '' ELSE '.' END
    || CASE WHEN v_charged > 0
         THEN format(' You were charged ₦%s for the time you danced.', btrim(to_char(v_charged / 100.0, 'FM999G999G990D00')))
         ELSE ' You weren''t charged.' END;
  PERFORM public.create_notification(v_hold.sprayer_id, 'floor_removed', 'Removed from the dance floor', v_body,
    jsonb_build_object('event_id', v_hold.event_id, 'hold_id', p_hold_id, 'charged_kobo', v_charged));

  PERFORM public.log_admin_action(p_admin_auth_id, 'remove_floor_hold', 'spray_hold', p_hold_id,
    jsonb_build_object('reason', v_reason, 'event_id', v_hold.event_id, 'sprayer_id', v_hold.sprayer_id,
                       'was_status', v_hold.status::text, 'charged_kobo', v_charged));

  RETURN jsonb_build_object('hold_id', p_hold_id, 'event_id', v_hold.event_id,
                            'was_status', v_hold.status::text, 'charged_kobo', v_charged);
END;
$$;

CREATE OR REPLACE FUNCTION public.admin_advance_floor(p_event_id uuid, p_admin_auth_id uuid)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE v_on int; v_q int;
BEGIN
  IF NOT EXISTS (SELECT 1 FROM public.events WHERE id = p_event_id) THEN RAISE EXCEPTION 'Event not found'; END IF;
  PERFORM public.advance_event_floor(p_event_id);
  PERFORM public._floor_ping(p_event_id);
  SELECT count(*) FILTER (WHERE status = 'on_floor'), count(*) FILTER (WHERE status = 'queued')
    INTO v_on, v_q FROM public.spray_holds WHERE event_id = p_event_id;
  PERFORM public.log_admin_action(p_admin_auth_id, 'advance_floor', 'event', p_event_id,
    jsonb_build_object('on_floor', v_on, 'queued', v_q));
  RETURN jsonb_build_object('event_id', p_event_id, 'on_floor', v_on, 'queued', v_q);
END;
$$;

REVOKE ALL ON FUNCTION public.admin_remove_floor_hold(uuid, uuid, uuid, text) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.admin_remove_floor_hold(uuid, uuid, uuid, text) TO service_role;
REVOKE ALL ON FUNCTION public.admin_advance_floor(uuid, uuid) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.admin_advance_floor(uuid, uuid) TO service_role;
