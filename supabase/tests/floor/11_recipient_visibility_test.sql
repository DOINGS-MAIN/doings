-- 104: the spray feed names who received each spray; the receiver can see sprays paid to them; strangers see nothing.
DO $$
DECLARE host uuid; g uuid; s uuid; other uuid; ev uuid; r record; n int;
BEGIN
  host := pg_temp.mk_user('vf-host@test.local', 0);
  g := pg_temp.mk_user('vf-g@test.local', 0);
  s := pg_temp.mk_user('vf-s@test.local', 10000000);
  other := pg_temp.mk_user('vf-other@test.local', 0);
  UPDATE public.users SET username = 'vf_guest' WHERE id = g;
  ev := pg_temp.mk_event(host);
  INSERT INTO public.event_call_ups (event_id, guest_id, status, responded_at) VALUES (ev, g, 'accepted', now());
  PERFORM public.queue_floor_spray(ev, s, 100000, 500, 2, g);

  PERFORM pg_temp.auth_as(host);
  SELECT * INTO r FROM public.get_event_spray_feed(ev, 10);
  ASSERT r.id IS NOT NULL, 'host sees the spray to a guest';
  ASSERT r.receiver_username = 'vf_guest', format('receiver named, got %s', r.receiver_username);

  PERFORM pg_temp.auth_as(g);
  SELECT count(*) INTO n FROM public.get_event_spray_feed(ev, 10);
  ASSERT n = 1, 'receiver sees the spray paid to them';

  PERFORM pg_temp.auth_as(s);
  SELECT count(*) INTO n FROM public.get_event_spray_feed(ev, 10);
  ASSERT n = 1, 'sprayer still sees theirs';

  PERFORM pg_temp.auth_as(other);
  SELECT count(*) INTO n FROM public.get_event_spray_feed(ev, 10);
  ASSERT n = 0, 'a stranger sees nothing';
END $$;
