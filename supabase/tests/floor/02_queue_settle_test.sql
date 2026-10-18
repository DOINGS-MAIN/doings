CREATE TEMP TABLE t (k text PRIMARY KEY, v uuid);

DO $$
DECLARE host uuid; a uuid; b uuid; ev uuid; h uuid; i int;
BEGIN
  host := pg_temp.mk_user('floor-host@test.local', 0);
  a := pg_temp.mk_user('floor-a@test.local', 10000000);   -- ₦100,000
  b := pg_temp.mk_user('floor-b@test.local', 10000000);
  ev := pg_temp.mk_event(host);
  INSERT INTO t VALUES ('host', host), ('a', a), ('b', b), ('ev', ev);
  FOR i IN 1..8 LOOP
    PERFORM public.queue_floor_spray(ev, pg_temp.mk_user('fill-' || i || '@test.local', 10000000), 20000, 200, 1);
  END LOOP;
  h := public.queue_floor_spray(ev, a, 5000000, 200, 250);   -- ₦50,000 in ₦200 notes, 9th
  INSERT INTO t VALUES ('ha', h);
END $$;

DO $$
DECLARE r record; w record;
BEGIN
  SELECT * INTO r FROM public.spray_holds WHERE id = (SELECT v FROM t WHERE k = 'ha');
  ASSERT r.status = 'queued', format('9th waits in line, got %s', r.status);
  ASSERT r.queued_at IS NOT NULL AND r.floor_band_seconds = 240, 'band from defaults: ₦50,000 = 240 s';
  ASSERT r.expires_at > now() + interval '29 minutes', 'max wait 30 min';
  SELECT * INTO w FROM pg_temp.wallet((SELECT v FROM t WHERE k = 'a'));
  ASSERT w.locked = 5000000 AND w.balance = 10000000, 'held, not charged';
END $$;

-- refusals: one per person, host, insufficient balance
DO $$
BEGIN
  BEGIN
    PERFORM public.queue_floor_spray((SELECT v FROM t WHERE k = 'ev'), (SELECT v FROM t WHERE k = 'a'), 20000, 200, 1);
    RAISE EXCEPTION 'expected FLOOR_ALREADY_IN';
  EXCEPTION WHEN others THEN ASSERT SQLERRM LIKE '%FLOOR_ALREADY_IN%', SQLERRM; END;
  BEGIN
    PERFORM public.queue_floor_spray((SELECT v FROM t WHERE k = 'ev'), (SELECT v FROM t WHERE k = 'host'), 20000, 200, 1);
    RAISE EXCEPTION 'expected host refusal';
  EXCEPTION WHEN others THEN ASSERT SQLERRM LIKE '%Host cannot spray%', SQLERRM; END;
  BEGIN
    PERFORM public.queue_floor_spray((SELECT v FROM t WHERE k = 'ev'), (SELECT v FROM t WHERE k = 'b'), 20000000, 1000, 200);
    RAISE EXCEPTION 'expected insufficient';
  EXCEPTION WHEN others THEN ASSERT SQLERRM LIKE '%Insufficient balance%', SQLERRM; END;
END $$;

-- leave: only the owner, releases everything, idempotent
DO $$
DECLARE w record; r record;
BEGIN
  BEGIN
    PERFORM public.leave_floor_queue((SELECT v FROM t WHERE k = 'ha'), (SELECT v FROM t WHERE k = 'b'));
    RAISE EXCEPTION 'expected Not authorized';
  EXCEPTION WHEN others THEN ASSERT SQLERRM LIKE '%Not authorized%', SQLERRM; END;
  ASSERT public.leave_floor_queue((SELECT v FROM t WHERE k = 'ha'), (SELECT v FROM t WHERE k = 'a')) = (SELECT v FROM t WHERE k = 'ev'), 'returns event id';
  SELECT * INTO r FROM public.spray_holds WHERE id = (SELECT v FROM t WHERE k = 'ha');
  ASSERT r.status = 'released' AND r.release_reason = 'left' AND r.charged_amount_kobo = 0, 'released as left';
  SELECT * INTO w FROM pg_temp.wallet((SELECT v FROM t WHERE k = 'a'));
  ASSERT w.locked = 0 AND w.balance = 10000000, 'fully unlocked';
  PERFORM public.leave_floor_queue((SELECT v FROM t WHERE k = 'ha'), (SELECT v FROM t WHERE k = 'a'));  -- no error the second time
END $$;

-- Stop is retired (101): refused, and the spray is unchanged.
DO $$
DECLARE h uuid;
BEGIN
  h := public.queue_floor_spray((SELECT v FROM t WHERE k = 'ev'), (SELECT v FROM t WHERE k = 'a'), 5000000, 200, 250);  -- 9th, waits
  BEGIN
    PERFORM public.stop_floor_spray(h, (SELECT v FROM t WHERE k = 'a'));
    RAISE EXCEPTION 'expected stop refusal';
  EXCEPTION WHEN others THEN ASSERT SQLERRM = 'Sprays can''t be stopped once they start', SQLERRM; END;
  ASSERT (SELECT status FROM public.spray_holds WHERE id = h) = 'queued', 'unchanged';
END $$;

SELECT 'queue/settle tests passed' AS result;
