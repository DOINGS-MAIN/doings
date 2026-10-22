-- 104: a spray can be paid to the host (default) or to a called-up guest; the recipient is validated and
-- locked when the hold is created; removal afterwards does not stop an already-held spray.
CREATE FUNCTION pg_temp.err(q text) RETURNS text LANGUAGE plpgsql AS $$
BEGIN EXECUTE q; RETURN NULL; EXCEPTION WHEN OTHERS THEN RETURN SQLERRM; END $$;
CREATE FUNCTION pg_temp.callup(p_ev uuid, p_guest uuid, p_status text) RETURNS void LANGUAGE sql AS $$
  INSERT INTO public.event_call_ups (event_id, guest_id, status, responded_at) VALUES (p_ev, p_guest, p_status, now())
$$;

-- A. default and host-as-recipient pay the host; an accepted guest is paid into their own bag.
DO $$
DECLARE host uuid; g uuid; s1 uuid; s2 uuid; s3 uuid; ev uuid; h uuid; r record; hw0 bigint; gw0 bigint;
BEGIN
  host := pg_temp.mk_user('rc-host@test.local', 0);
  g := pg_temp.mk_user('rc-g@test.local', 500000);
  s1 := pg_temp.mk_user('rc-s1@test.local', 10000000);
  s2 := pg_temp.mk_user('rc-s2@test.local', 10000000);
  s3 := pg_temp.mk_user('rc-s3@test.local', 10000000);
  ev := pg_temp.mk_event(host);
  INSERT INTO public.event_participants (event_id, user_id) VALUES (ev, g);
  PERFORM pg_temp.callup(ev, g, 'accepted');

  PERFORM public.queue_floor_spray(ev, s1, 100000, 500, 2);
  ASSERT (SELECT balance FROM pg_temp.wallet(host)) = 100000, 'no recipient: host paid';
  PERFORM public.queue_floor_spray(ev, s2, 100000, 500, 2, host);
  ASSERT (SELECT balance FROM pg_temp.wallet(host)) = 200000, 'host as recipient: host paid';

  hw0 := (SELECT balance FROM pg_temp.wallet(host)); gw0 := (SELECT balance FROM pg_temp.wallet(g));
  h := public.queue_floor_spray(ev, s3, 100000, 500, 2, g);
  SELECT * INTO r FROM public.spray_holds WHERE id = h;
  ASSERT r.status = 'on_floor' AND r.transfer_id IS NOT NULL AND r.recipient_id = g, 'guest hold charged at entry, recipient kept';
  ASSERT (SELECT balance FROM pg_temp.wallet(g)) = gw0 + 100000, 'guest paid into own bag';
  ASSERT (SELECT balance FROM pg_temp.wallet(host)) = hw0, 'host not paid';
  ASSERT (SELECT balance FROM pg_temp.wallet(s3)) = 9900000, 'sprayer debited';
  ASSERT (SELECT receiver_id FROM public.spray_records WHERE sprayer_id = s3 AND event_id = ev) = g, 'record names the guest';
  ASSERT (SELECT total_sprayed FROM public.events WHERE id = ev) = 300000, 'event total counts every spray';
  ASSERT EXISTS (SELECT 1 FROM public.notifications WHERE user_id = g AND type = 'spray_received'), 'guest told';
  ASSERT NOT EXISTS (SELECT 1 FROM public.notifications WHERE user_id = host AND type = 'spray_received'
                       AND (data->>'sprayer_id')::uuid = s3), 'host not told about the guest''s spray';
  ASSERT (SELECT receiver_user_id FROM public.transfers WHERE id = r.transfer_id) = g, 'transfer to the guest';
END $$;

-- B. invalid recipients are refused (and nothing is locked).
DO $$
DECLARE host uuid; ev uuid; ev2 uuid; gd uuid; gr uuid; gp uuid; gx uuid; s uuid; selfg uuid; q text;
BEGIN
  host := pg_temp.mk_user('ri-host@test.local', 0);
  ev := pg_temp.mk_event(host); ev2 := pg_temp.mk_event(host);
  gd := pg_temp.mk_user('ri-declined@test.local', 0);
  gr := pg_temp.mk_user('ri-removed@test.local', 0);
  gp := pg_temp.mk_user('ri-pending@test.local', 0);
  gx := pg_temp.mk_user('ri-other@test.local', 0);
  selfg := pg_temp.mk_user('ri-self@test.local', 10000000);
  s := pg_temp.mk_user('ri-s@test.local', 10000000);
  PERFORM pg_temp.callup(ev, gd, 'declined');
  PERFORM pg_temp.callup(ev, gr, 'removed');
  PERFORM pg_temp.callup(ev, gp, 'pending');
  PERFORM pg_temp.callup(ev2, gx, 'accepted');       -- accepted, but at another event
  PERFORM pg_temp.callup(ev, selfg, 'accepted');
  FOREACH q IN ARRAY ARRAY[gd::text, gr::text, gp::text, gx::text, s::text] LOOP
    ASSERT pg_temp.err(format('SELECT public.queue_floor_spray(%L, %L, 100000, 500, 2, %L)', ev, s, q)) = 'CALLUP_RECIPIENT_INVALID',
      'refused: ' || q;
  END LOOP;
  ASSERT pg_temp.err(format('SELECT public.queue_floor_spray(%L, %L, 100000, 500, 2, %L)', ev, selfg, selfg)) = 'CALLUP_RECIPIENT_INVALID',
    'a called-up guest cannot spray themselves';
  ASSERT (SELECT locked FROM pg_temp.wallet(s)) = 0 AND NOT EXISTS (SELECT 1 FROM public.spray_holds WHERE sprayer_id = s), 'nothing held';
END $$;

-- C. locked at the hold: a guest removed while the spray waits in line is still paid when it steps up.
DO $$
DECLARE host uuid; g uuid; ev uuid; i int; fill uuid[] := '{}'; q uuid; hq uuid; r record; gw0 bigint;
BEGIN
  host := pg_temp.mk_user('rf-host@test.local', 0);
  g := pg_temp.mk_user('rf-g@test.local', 0);
  ev := pg_temp.mk_event(host);
  PERFORM pg_temp.callup(ev, g, 'accepted');
  FOR i IN 1..8 LOOP
    fill := fill || public.queue_floor_spray(ev, pg_temp.mk_user('rf-fill-' || i || '@test.local', 10000000), 20000, 200, 1);
  END LOOP;
  q := pg_temp.mk_user('rf-q@test.local', 10000000);
  hq := public.queue_floor_spray(ev, q, 100000, 500, 2, g);
  ASSERT (SELECT status FROM public.spray_holds WHERE id = hq) = 'queued', 'waiting in line';
  UPDATE public.event_call_ups SET status = 'removed', removed_by = 'host' WHERE event_id = ev AND guest_id = g;
  gw0 := (SELECT balance FROM pg_temp.wallet(g));
  UPDATE public.spray_holds SET floor_started_at = now() - interval '61 seconds', floor_ends_at = now() - interval '1 second' WHERE id = fill[1];
  PERFORM public.advance_event_floor(ev);
  SELECT * INTO r FROM public.spray_holds WHERE id = hq;
  ASSERT r.status = 'on_floor' AND r.transfer_id IS NOT NULL, 'stepped up and charged';
  ASSERT (SELECT balance FROM pg_temp.wallet(g)) = gw0 + 100000, 'removed guest still paid';
END $$;

-- D. a recipient who cannot be credited releases the hold with charge_failed and returns the lock.
DO $$
DECLARE host uuid; g uuid; s uuid; ev uuid; h uuid; r record;
BEGIN
  host := pg_temp.mk_user('rw-host@test.local', 0);
  g := pg_temp.mk_user('rw-g@test.local', 0);
  s := pg_temp.mk_user('rw-s@test.local', 10000000);
  ev := pg_temp.mk_event(host);
  PERFORM pg_temp.callup(ev, g, 'accepted');
  DELETE FROM public.wallets WHERE user_id = g AND currency = 'NGN';
  h := public.queue_floor_spray(ev, s, 100000, 500, 2, g);
  SELECT * INTO r FROM public.spray_holds WHERE id = h;
  ASSERT r.status = 'released' AND r.release_reason = 'charge_failed', format('released charge_failed, got %s/%s', r.status, r.release_reason);
  ASSERT (SELECT balance FROM pg_temp.wallet(s)) = 10000000 AND (SELECT locked FROM pg_temp.wallet(s)) = 0, 'nothing charged, lock returned';
END $$;

-- E. a legacy hold (no recipient, never charged) is still settled to the host.
DO $$
DECLARE host uuid; ev uuid; a uuid; aw uuid; ha uuid; r record;
BEGIN
  host := pg_temp.mk_user('lr-host@test.local', 0);
  ev := pg_temp.mk_event(host);
  a := pg_temp.mk_user('lr-a@test.local', 10000000);
  aw := (SELECT id FROM public.wallets WHERE user_id = a AND currency = 'NGN');
  UPDATE public.wallets SET locked_balance = 200000 WHERE id = aw;
  INSERT INTO public.spray_holds (event_id, sprayer_id, wallet_id, planned_amount_kobo, denomination, note_count, status, metadata,
                                  expires_at, queued_at, floor_seconds, floor_band_seconds, floor_slot, floor_started_at, floor_ends_at)
  VALUES (ev, a, aw, 200000, 200, 10, 'on_floor', '{"floor": true}', now() + interval '1 hour', now() - interval '2 minutes',
          60, 60, 1, now() - interval '61 seconds', now() - interval '1 second')
  RETURNING id INTO ha;
  PERFORM public.advance_event_floor(ev);
  SELECT * INTO r FROM public.spray_holds WHERE id = ha;
  ASSERT r.status = 'settled' AND r.transfer_id IS NOT NULL, 'legacy settled';
  ASSERT (SELECT balance FROM pg_temp.wallet(host)) = 200000, 'legacy paid the host';
  ASSERT (SELECT receiver_id FROM public.spray_records WHERE event_id = ev) = host, 'record names the host';
END $$;
