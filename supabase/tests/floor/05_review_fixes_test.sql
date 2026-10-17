CREATE TEMP TABLE t (k text PRIMARY KEY, v uuid);

-- Critical 1: ending the event settles the floor at once, charging only up to the end.
DO $$
DECLARE host uuid; ev uuid; a uuid; b uuid; ha uuid; hb uuid; i int; r record;
BEGIN
  host := pg_temp.mk_user('rf-host@test.local', 0);
  ev := pg_temp.mk_event(host);
  a := pg_temp.mk_user('rf-a@test.local', 10000000);
  ha := public.queue_floor_spray(ev, a, 2000000, 1000, 20);     -- ₦20,000, 120 s turn, on the floor
  FOR i IN 1..7 LOOP PERFORM public.queue_floor_spray(ev, pg_temp.mk_user('rf-' || i || '@test.local', 10000000), 100000, 500, 2); END LOOP;
  b := pg_temp.mk_user('rf-b@test.local', 10000000);
  hb := public.queue_floor_spray(ev, b, 100000, 500, 2);        -- 9th, in line
  UPDATE public.spray_holds SET floor_started_at = now() - interval '30 seconds', floor_ends_at = now() + interval '90 seconds' WHERE id = ha;
  UPDATE public.events SET status = 'ended' WHERE id = ev;      -- no advance call: the trigger must settle
  SELECT * INTO r FROM public.spray_holds WHERE id = ha;
  ASSERT r.status = 'settled' AND r.charged_amount_kobo = 2000000 AND r.release_reason = 'event_ended_on_floor',
    format('paid on stepping on; the end moves no money, got %s/%s', r.status, r.charged_amount_kobo);
  SELECT * INTO r FROM public.spray_holds WHERE id = hb;
  ASSERT r.status = 'released' AND r.release_reason = 'event_ended', 'queue released by the end trigger';
  ASSERT (SELECT ended_at FROM public.events WHERE id = ev) IS NOT NULL, 'ended_at stamped';
  INSERT INTO t VALUES ('ev', ev);
END $$;

-- Critical 1 (cap), legacy pre-101 hold: a late settle never charges past ended_at.
DO $$
DECLARE host uuid; ev uuid; a uuid; ha uuid; r record;
BEGIN
  host := pg_temp.mk_user('rc-host@test.local', 0);
  ev := pg_temp.mk_event(host);
  a := pg_temp.mk_user('rc-a@test.local', 10000000);
  UPDATE public.wallets SET locked_balance = 2000000 WHERE user_id = a AND currency = 'NGN';
  INSERT INTO public.spray_holds (event_id, sprayer_id, wallet_id, planned_amount_kobo, denomination, note_count, status, metadata,
                                  expires_at, queued_at, floor_seconds, floor_band_seconds, floor_slot, floor_started_at, floor_ends_at)
  VALUES (ev, a, (SELECT id FROM public.wallets WHERE user_id = a AND currency = 'NGN'), 2000000, 1000, 20, 'on_floor',
          '{"floor": true}', now() + interval '1 hour', now() - interval '3 minutes', 120, 120, 1, now(), now() + interval '120 seconds')
  RETURNING id INTO ha;
  -- simulate an end that the trigger could not settle: status already ended 90 s ago, row still on the floor
  ALTER TABLE public.events DISABLE TRIGGER tr_events_floor_end;
  UPDATE public.events SET status = 'ended', ended_at = now() - interval '90 seconds' WHERE id = ev;
  ALTER TABLE public.events ENABLE TRIGGER tr_events_floor_end;
  UPDATE public.spray_holds SET floor_started_at = now() - interval '120 seconds', floor_ends_at = now() WHERE id = ha;
  PERFORM public.advance_event_floor(ev);
  SELECT * INTO r FROM public.spray_holds WHERE id = ha;
  ASSERT r.charged_amount_kobo = 500000, format('capped at ended_at: 30 s of 120 s = 5 notes, got %s', r.charged_amount_kobo);
END $$;

-- Minor 6: on the floor under one note when the event ends -> its own reason.
DO $$
DECLARE host uuid; ev uuid; a uuid; ha uuid; r record;
BEGIN
  host := pg_temp.mk_user('r6-host@test.local', 0);
  ev := pg_temp.mk_event(host);
  a := pg_temp.mk_user('r6-a@test.local', 10000000);
  ha := public.queue_floor_spray(ev, a, 20000, 200, 1);
  UPDATE public.events SET status = 'ended' WHERE id = ev;
  SELECT * INTO r FROM public.spray_holds WHERE id = ha;
  ASSERT r.status = 'settled' AND r.release_reason = 'event_ended_on_floor' AND r.charged_amount_kobo = 20000,
    format('one note, paid on stepping on, got %s/%s', r.status, r.release_reason);
END $$;

-- Important 4: settings with missing keys are rejected.
DO $$
DECLARE s jsonb := public.floor_default_settings();
BEGIN
  ASSERT public.floor_settings_errors('{}'::jsonb) IS NOT NULL, 'empty settings';
  ASSERT public.floor_settings_errors(s - 'min_seconds') IS NOT NULL, 'missing min_seconds';
  ASSERT public.floor_settings_errors(s - 'busy_threshold') IS NOT NULL, 'missing busy_threshold';
  ASSERT public.floor_settings_errors(s - 'max_wait_seconds') IS NOT NULL, 'missing max_wait';
  ASSERT public.floor_settings_errors(jsonb_set(s, '{bands}', '[{"from_ngn":0}]')) IS NOT NULL, 'band without seconds';
END $$;

-- NULL charge guard
DO $$
DECLARE host uuid; ev uuid; a uuid; ha uuid;
BEGIN
  host := pg_temp.mk_user('rn-host@test.local', 0);
  ev := pg_temp.mk_event(host);
  a := pg_temp.mk_user('rn-a@test.local', 10000000);
  ha := public.queue_floor_spray(ev, a, 20000, 200, 1);
  BEGIN
    PERFORM public._settle_floor_hold(ha, NULL);
    RAISE EXCEPTION 'expected Invalid floor charge';
  EXCEPTION WHEN others THEN ASSERT SQLERRM LIKE '%Invalid floor charge%', SQLERRM; END;
END $$;

SELECT 'review fix tests passed' AS result;
