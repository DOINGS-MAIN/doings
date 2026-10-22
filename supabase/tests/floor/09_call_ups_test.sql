-- 104: call-ups. Guests request, the host accepts; cancel/step-down; throttle (3 in 5 min); visibility.
CREATE FUNCTION pg_temp.err(q text) RETURNS text LANGUAGE plpgsql AS $$
BEGIN EXECUTE q; RETURN NULL; EXCEPTION WHEN OTHERS THEN RETURN SQLERRM; END $$;

DO $$
DECLARE host uuid; g1 uuid; g2 uuid; g3 uuid; outsider uuid; ev uuid; ev2 uuid; st jsonb; cid uuid; cid2 uuid; n int;
BEGIN
  host := pg_temp.mk_user('cu-host@test.local', 0);
  g1 := pg_temp.mk_user('cu-g1@test.local', 0);
  g2 := pg_temp.mk_user('cu-g2@test.local', 0);
  g3 := pg_temp.mk_user('cu-g3@test.local', 0);
  outsider := pg_temp.mk_user('cu-out@test.local', 0);
  ev := pg_temp.mk_event(host);
  INSERT INTO public.event_participants (event_id, user_id) VALUES (ev, g1), (ev, g2), (ev, g3);

  -- request, idempotent, hidden from guests, visible to the host
  PERFORM pg_temp.auth_as(g1);
  PERFORM public.request_call_up(ev);
  PERFORM public.request_call_up(ev);
  st := public.get_call_ups(ev);
  ASSERT st->'me'->>'status' = 'pending', 'g1 pending';
  ASSERT (SELECT count(*) FROM public.event_call_ups WHERE event_id = ev AND guest_id = g1) = 1, 'second request is idempotent';
  ASSERT jsonb_array_length(st->'pending') = 0, 'guest does not see pending requests';
  PERFORM pg_temp.auth_as(host);
  st := public.get_call_ups(ev);
  ASSERT jsonb_array_length(st->'pending') = 1, 'host sees the request';
  ASSERT st->'me'->>'status' = 'none', 'host me is none';
  cid := (st->'pending'->0->>'call_up_id')::uuid;

  -- only the host responds
  PERFORM pg_temp.auth_as(g2);
  ASSERT pg_temp.err(format('SELECT public.respond_call_up(%L, true)', cid)) = 'CALLUP_NOT_HOST', 'non-host cannot respond';
  ASSERT pg_temp.err(format('SELECT public.accept_all_call_ups(%L)', ev)) = 'CALLUP_NOT_HOST', 'non-host cannot accept all';
  ASSERT pg_temp.err(format('SELECT public.remove_call_up(%L)', cid)) = 'CALLUP_NOT_HOST', 'non-host cannot remove';

  -- accept: appears in called_up for everyone
  PERFORM pg_temp.auth_as(host);
  PERFORM public.respond_call_up(cid, true);
  PERFORM pg_temp.auth_as(g2);
  st := public.get_call_ups(ev);
  ASSERT jsonb_array_length(st->'called_up') = 1 AND st->'called_up'->0->>'id' = g1::text, 'g2 sees g1 called up';
  PERFORM pg_temp.auth_as(g1);
  ASSERT public.get_call_ups(ev)->'me'->>'status' = 'accepted', 'g1 accepted';

  -- step down (cancel on accepted)
  PERFORM public.cancel_call_up(ev);
  ASSERT (SELECT status || '/' || removed_by FROM public.event_call_ups WHERE id = cid) = 'removed/guest', 'step down';
  ASSERT public.get_call_ups(ev)->'me'->>'status' = 'none', 'g1 none again';

  -- request again, host removes
  PERFORM public.request_call_up(ev);
  SELECT id INTO cid2 FROM public.event_call_ups WHERE guest_id = g1 AND status = 'pending';
  PERFORM pg_temp.auth_as(host);
  PERFORM public.respond_call_up(cid2, true);
  PERFORM public.remove_call_up(cid2);
  ASSERT (SELECT status || '/' || removed_by FROM public.event_call_ups WHERE id = cid2) = 'removed/host', 'host removes';

  -- decline, then accept all
  PERFORM pg_temp.auth_as(g2); PERFORM public.request_call_up(ev);
  PERFORM pg_temp.auth_as(host);
  SELECT id INTO cid FROM public.event_call_ups WHERE guest_id = g2 AND status = 'pending';
  PERFORM public.respond_call_up(cid, false);
  ASSERT (SELECT status FROM public.event_call_ups WHERE id = cid) = 'declined', 'declined';
  PERFORM pg_temp.auth_as(g2); ASSERT public.get_call_ups(ev)->'me'->>'status' = 'none', 'declined shows none';
  PERFORM public.request_call_up(ev);
  PERFORM pg_temp.auth_as(g3); PERFORM public.request_call_up(ev);
  PERFORM pg_temp.auth_as(host);
  n := (public.accept_all_call_ups(ev))::text::int;
  ASSERT n = 2, format('accept all accepted %s', n);
  ASSERT NOT EXISTS (SELECT 1 FROM public.event_call_ups WHERE event_id = ev AND status = 'pending'), 'none pending';

  -- eligibility
  ASSERT pg_temp.err(format('SELECT public.request_call_up(%L)', ev)) = 'CALLUP_HOST', 'host cannot request';
  PERFORM pg_temp.auth_as(outsider);
  ASSERT pg_temp.err(format('SELECT public.request_call_up(%L)', ev)) = 'CALLUP_NOT_JOINED', 'outsider cannot request';
  ev2 := pg_temp.mk_event(host);
  INSERT INTO public.event_participants (event_id, user_id) VALUES (ev2, outsider);
  UPDATE public.events SET status = 'ended' WHERE id = ev2;
  ASSERT pg_temp.err(format('SELECT public.request_call_up(%L)', ev2)) = 'CALLUP_NOT_LIVE', 'not live';
END $$;

-- throttle: 3 requests in 5 minutes, the 4th is refused; cancels do not reset it; ageing the rows lifts it
DO $$
DECLARE host uuid; g uuid; ev uuid; st jsonb; i int;
BEGIN
  host := pg_temp.mk_user('cuth-host@test.local', 0);
  g := pg_temp.mk_user('cuth-g@test.local', 0);
  ev := pg_temp.mk_event(host);
  INSERT INTO public.event_participants (event_id, user_id) VALUES (ev, g);
  PERFORM pg_temp.auth_as(g);
  FOR i IN 1..3 LOOP
    PERFORM public.request_call_up(ev);
    PERFORM public.cancel_call_up(ev);
  END LOOP;
  ASSERT pg_temp.err(format('SELECT public.request_call_up(%L)', ev)) = 'CALLUP_THROTTLED', 'fourth request throttled';
  st := public.get_call_ups(ev);
  ASSERT st->'me'->>'status' = 'none' AND (st->'me'->>'retry_after_seconds')::int BETWEEN 1 AND 300,
    format('retry_after in range, got %s', st->'me');
  UPDATE public.event_call_ups SET requested_at = requested_at - interval '6 minutes' WHERE event_id = ev;
  PERFORM public.request_call_up(ev);
  ASSERT public.get_call_ups(ev)->'me'->>'status' = 'pending', 'allowed after the window';
  ASSERT (public.get_call_ups(ev)->'me'->>'retry_after_seconds')::int = 0, 'no cooldown shown when allowed';
END $$;
