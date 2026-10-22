-- 104: what the host actually received (sprays paid to the host), host-only; the event total still counts every spray.
CREATE FUNCTION pg_temp.err(q text) RETURNS text LANGUAGE plpgsql AS $$
BEGIN EXECUTE q; RETURN NULL; EXCEPTION WHEN OTHERS THEN RETURN SQLERRM; END $$;
DO $$
DECLARE host uuid; g uuid; s1 uuid; s2 uuid; ev uuid; n bigint;
BEGIN
  host := pg_temp.mk_user('hr-host@test.local', 0);
  g := pg_temp.mk_user('hr-g@test.local', 0);
  s1 := pg_temp.mk_user('hr-s1@test.local', 10000000);
  s2 := pg_temp.mk_user('hr-s2@test.local', 10000000);
  ev := pg_temp.mk_event(host);
  INSERT INTO public.event_call_ups (event_id, guest_id, status, responded_at) VALUES (ev, g, 'accepted', now());
  PERFORM public.queue_floor_spray(ev, s1, 100000, 500, 2);          -- to the host
  PERFORM public.queue_floor_spray(ev, s2, 300000, 1000, 3, g);       -- to the guest

  PERFORM pg_temp.auth_as(host);
  n := public.get_event_host_received(ev);
  ASSERT n = 100000, format('host received only the spray paid to the host, got %s', n);
  ASSERT (SELECT total_sprayed FROM public.events WHERE id = ev) = 400000, 'event total counts every spray';

  PERFORM pg_temp.auth_as(g);
  ASSERT pg_temp.err(format('SELECT public.get_event_host_received(%L)', ev)) = 'CALLUP_NOT_HOST', 'host only';
END $$;
