CREATE TEMP TABLE t (k text PRIMARY KEY, v uuid);

-- 9 sprayers on one event: 8 fill slots 1..8 in FIFO order, the 9th waits.
DO $$
DECLARE host uuid; ev uuid; u uuid; i int; h uuid;
BEGIN
  host := pg_temp.mk_user('adv-host@test.local', 0);
  ev := pg_temp.mk_event(host);
  INSERT INTO t VALUES ('host', host), ('ev', ev);
  FOR i IN 1..9 LOOP
    u := pg_temp.mk_user('adv-' || i || '@test.local', 10000000);
    h := public.queue_floor_spray(ev, u, 100000, 500, 2);   -- ₦1,000 = 60 s band
    INSERT INTO t VALUES ('u' || i, u), ('h' || i, h);
  END LOOP;
END $$;

DO $$
DECLARE r record; i int;
BEGIN
  FOR i IN 1..8 LOOP
    SELECT * INTO r FROM public.spray_holds WHERE id = (SELECT v FROM t WHERE k = 'h' || i);
    ASSERT r.status = 'on_floor' AND r.floor_slot = i, format('h%s on floor in slot %s, got %s/%s', i, i, r.status, r.floor_slot);
    ASSERT r.floor_seconds = 60 AND r.floor_ends_at = r.floor_started_at + interval '60 seconds', 'turn length';
  END LOOP;
  SELECT * INTO r FROM public.spray_holds WHERE id = (SELECT v FROM t WHERE k = 'h9');
  ASSERT r.status = 'queued', '9th waits';
END $$;

-- turn 3 ends: settled in full, slot 3 goes to the 9th; a second run does nothing.
DO $$
DECLARE r record;
BEGIN
  UPDATE public.spray_holds SET floor_started_at = now() - interval '61 seconds', floor_ends_at = now() - interval '1 second'
   WHERE id = (SELECT v FROM t WHERE k = 'h3');
  ASSERT public.advance_event_floor((SELECT v FROM t WHERE k = 'ev')), 'changed';
  SELECT * INTO r FROM public.spray_holds WHERE id = (SELECT v FROM t WHERE k = 'h3');
  ASSERT r.status = 'settled' AND r.settlement_type = 'full' AND r.charged_amount_kobo = 100000, 'time up = full';
  SELECT * INTO r FROM public.spray_holds WHERE id = (SELECT v FROM t WHERE k = 'h9');
  ASSERT r.status = 'on_floor' AND r.floor_slot = 3, 'lowest free slot';
  ASSERT NOT public.advance_event_floor((SELECT v FROM t WHERE k = 'ev')), 'second run: nothing to do';
END $$;

-- busy floor: ₦20,000 in ₦1,000 notes (20 notes, 120 s band). 21 sprayers: 8 on, 13 waiting.
DO $$
DECLARE host uuid; ev uuid; u uuid; i int; h uuid; r record;
BEGIN
  host := pg_temp.mk_user('busy-host@test.local', 0);
  ev := pg_temp.mk_event(host);
  INSERT INTO t VALUES ('bev', ev);
  FOR i IN 1..21 LOOP
    u := pg_temp.mk_user('busy-' || i || '@test.local', 10000000);
    h := public.queue_floor_spray(ev, u, 2000000, 1000, 20);
    INSERT INTO t VALUES ('b' || i, h);
  END LOOP;
  SELECT * INTO r FROM public.spray_holds WHERE id = (SELECT v FROM t WHERE k = 'b1');
  ASSERT r.floor_seconds = 120, 'first on with an empty queue: full band';
  -- free slot 1; the 9th steps on with 12 still waiting (> 10): round(120 × 0.7) = 84 s
  UPDATE public.spray_holds SET floor_ends_at = now() - interval '1 second', floor_started_at = now() - interval '121 seconds'
   WHERE id = (SELECT v FROM t WHERE k = 'b1');
  PERFORM public.advance_event_floor(ev);
  SELECT * INTO r FROM public.spray_holds WHERE id = (SELECT v FROM t WHERE k = 'b9');
  ASSERT r.status = 'on_floor' AND r.floor_seconds = 84, format('busy shrink, got %s', r.floor_seconds);
END $$;

-- max wait: a queued spray past expires_at is released in full.
DO $$
DECLARE r record;
BEGIN
  UPDATE public.spray_holds SET expires_at = now() - interval '1 second' WHERE id = (SELECT v FROM t WHERE k = 'b21');
  PERFORM public.advance_event_floor((SELECT v FROM t WHERE k = 'bev'));
  SELECT * INTO r FROM public.spray_holds WHERE id = (SELECT v FROM t WHERE k = 'b21');
  ASSERT r.status = 'released' AND r.release_reason = 'max_wait' AND r.charged_amount_kobo = 0, 'max wait release';
END $$;

-- event ends: on-floor (paid on the way in) finished with no money moving, queued released.
DO $$
DECLARE ev uuid := (SELECT v FROM t WHERE k = 'bev'); r record;
BEGIN
  UPDATE public.spray_holds SET floor_started_at = now() - interval '60 seconds', floor_ends_at = now() + interval '60 seconds',
         floor_seconds = 120
   WHERE id = (SELECT v FROM t WHERE k = 'b2');
  UPDATE public.events SET status = 'ended' WHERE id = ev;
  -- the end trigger settles the floor; an explicit advance afterwards has nothing left to do
  ASSERT NOT public.advance_event_floor(ev), 'already settled by the end trigger';
  SELECT * INTO r FROM public.spray_holds WHERE id = (SELECT v FROM t WHERE k = 'b2');
  ASSERT r.status = 'settled' AND r.charged_amount_kobo = 2000000 AND r.release_reason = 'event_ended_on_floor',
    format('paid in full on stepping on, finished at the end, got %s/%s', r.status, r.charged_amount_kobo);
  SELECT * INTO r FROM public.spray_holds WHERE id = (SELECT v FROM t WHERE k = 'b20');
  ASSERT r.status = 'released' AND r.release_reason = 'event_ended', 'queue released at event end';
  ASSERT NOT EXISTS (SELECT 1 FROM public.spray_holds WHERE event_id = ev AND status IN ('queued', 'on_floor')), 'floor cleared';
END $$;

-- old-app pending holds are not touched by the floor, and the old settle still works.
DO $$
DECLARE host uuid; u uuid; ev uuid; h uuid;
BEGIN
  host := pg_temp.mk_user('old-host@test.local', 0);
  u := pg_temp.mk_user('old-u@test.local', 10000000);
  ev := pg_temp.mk_event(host);
  h := public.create_spray_hold(ev, u, 20000, 200, 1, '{}'::jsonb, 600);
  PERFORM public.advance_event_floor(ev);
  ASSERT (SELECT status FROM public.spray_holds WHERE id = h) = 'pending', 'pending untouched';
  PERFORM public.settle_spray_hold(h, u, 'full', 0);
  ASSERT (SELECT status FROM public.spray_holds WHERE id = h) = 'settled', 'old settle still works';
END $$;

-- cron backstop
DO $$ BEGIN ASSERT public.advance_live_floors() >= 0, 'advance_live_floors runs'; END $$;

-- a sprayer who loses verification mid-turn: their turn still ends normally (they paid on the way in).
DO $$
DECLARE host uuid; ev uuid; bad uuid; good uuid; hb uuid; hg uuid; i int; r record;
BEGIN
  host := pg_temp.mk_user('iso-host@test.local', 0);
  ev := pg_temp.mk_event(host);
  bad := pg_temp.mk_user('iso-bad@test.local', 10000000);
  hb := public.queue_floor_spray(ev, bad, 100000, 500, 2);
  FOR i IN 1..7 LOOP PERFORM public.queue_floor_spray(ev, pg_temp.mk_user('iso-' || i || '@test.local', 10000000), 100000, 500, 2); END LOOP;
  good := pg_temp.mk_user('iso-good@test.local', 10000000);
  hg := public.queue_floor_spray(ev, good, 100000, 500, 2);   -- 9th, waiting
  UPDATE public.users SET kyc_level = 0 WHERE id = bad;
  UPDATE public.spray_holds SET floor_started_at = now() - interval '61 seconds', floor_ends_at = now() - interval '1 second' WHERE id = hb;
  PERFORM public.advance_event_floor(ev);
  SELECT * INTO r FROM public.spray_holds WHERE id = hb;
  ASSERT r.status = 'settled' AND r.charged_amount_kobo = 100000, 'turn ended; charged once, on the way in';
  SELECT * INTO r FROM public.spray_holds WHERE id = hg;
  ASSERT r.status = 'on_floor' AND r.transfer_id IS NOT NULL, 'next person stepped up and paid';
END $$;

SELECT 'advance tests passed' AS result;
