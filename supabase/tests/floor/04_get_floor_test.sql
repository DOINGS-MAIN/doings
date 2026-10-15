CREATE TEMP TABLE t (k text PRIMARY KEY, v uuid);

DO $$
DECLARE host uuid; ev uuid; pev uuid; i int; u uuid; h uuid; stranger uuid; guest uuid;
BEGIN
  host := pg_temp.mk_user('gf-host@test.local', 0);
  ev := pg_temp.mk_event(host);
  pev := pg_temp.mk_event(host, true);
  stranger := pg_temp.mk_user('gf-stranger@test.local', 0);
  guest := pg_temp.mk_user('gf-guest@test.local', 10000000);
  INSERT INTO public.event_participants (event_id, user_id, role) VALUES (pev, guest, 'guest');
  INSERT INTO t VALUES ('host', host), ('ev', ev), ('pev', pev), ('stranger', stranger), ('guest', guest);
  FOR i IN 1..10 LOOP
    u := pg_temp.mk_user('gf-' || i || '@test.local', 10000000);
    h := public.queue_floor_spray(ev, u, 100000, 500, 2);   -- ₦1,000: 60 s each
    INSERT INTO t VALUES ('u' || i, u), ('h' || i, h);
  END LOOP;
END $$;

-- a queued sprayer sees their own position and ETA; the floor is public.
SELECT pg_temp.auth_as((SELECT v FROM t WHERE k = 'u10'));
CREATE TEMP TABLE f AS SELECT public.get_event_floor((SELECT v FROM t WHERE k = 'ev')) AS j;
DO $$
DECLARE j jsonb := (SELECT j FROM f);
BEGIN
  ASSERT jsonb_array_length(j->'floor') = 8, 'eight on the floor';
  ASSERT (j->>'waiting_count')::int = 2, 'two waiting';
  ASSERT j->'me'->>'status' = 'queued' AND (j->'me'->>'position')::int = 2, 'u10 is 2nd in line';
  ASSERT (j->'me'->>'eta_seconds')::int BETWEEN 59 AND 61, format('ETA ≈ 60 s, got %s', j->'me'->>'eta_seconds');
  ASSERT (j->'floor'->0->>'slot')::int = 1 AND (j->'floor'->0->>'is_me')::boolean = false, 'ordered by slot';
  ASSERT j->'floor'->0 ? 'name' AND j->'floor'->0 ? 'avatar_url' AND (j->'floor'->0->>'amount_kobo')::bigint = 100000, 'dancer fields';
  ASSERT NOT (j::text LIKE '%' || (SELECT v FROM t WHERE k = 'h9')::text || '%'), 'other queued holds are not exposed';
  ASSERT jsonb_array_length(j->'bands') = 4 AND (j->'busy'->>'threshold')::int = 10, 'bands and busy rule';
END $$;

-- anonymous viewers see public floors, not private ones; strangers are refused on private ones.
SELECT set_config('request.jwt.claims', '', true);
DO $$
BEGIN
  ASSERT (public.get_event_floor((SELECT v FROM t WHERE k = 'ev'))->'me') = 'null'::jsonb, 'anon: no me';
  BEGIN
    PERFORM public.get_event_floor((SELECT v FROM t WHERE k = 'pev'));
    RAISE EXCEPTION 'expected Not authorized';
  EXCEPTION WHEN others THEN ASSERT SQLERRM LIKE '%Not authorized%', SQLERRM; END;
END $$;
SELECT pg_temp.auth_as((SELECT v FROM t WHERE k = 'stranger'));
DO $$
BEGIN
  BEGIN
    PERFORM public.get_event_floor((SELECT v FROM t WHERE k = 'pev'));
    RAISE EXCEPTION 'expected Not authorized';
  EXCEPTION WHEN others THEN ASSERT SQLERRM LIKE '%Not authorized%', SQLERRM; END;
END $$;
SELECT pg_temp.auth_as((SELECT v FROM t WHERE k = 'guest'));
DO $$ BEGIN ASSERT public.get_event_floor((SELECT v FROM t WHERE k = 'pev')) ? 'floor', 'joined guest can read private floor'; END $$;
SELECT pg_temp.auth_as((SELECT v FROM t WHERE k = 'host'));
DO $$ BEGIN ASSERT public.get_event_floor((SELECT v FROM t WHERE k = 'pev')) ? 'floor', 'host can read private floor'; END $$;

-- after leaving, me still shows the released row (2-minute window).
DO $$ BEGIN PERFORM public.leave_floor_queue((SELECT v FROM t WHERE k = 'h10'), (SELECT v FROM t WHERE k = 'u10')); END $$;
SELECT pg_temp.auth_as((SELECT v FROM t WHERE k = 'u10'));
DO $$
DECLARE j jsonb := public.get_event_floor((SELECT v FROM t WHERE k = 'ev'));
BEGIN
  ASSERT j->'me'->>'status' = 'released' AND j->'me'->>'release_reason' = 'left' AND (j->'me'->>'charged_kobo')::bigint = 0, 'released me';
  ASSERT j->'me'->'position' = 'null'::jsonb, 'no position once closed';
END $$;

SELECT 'get_event_floor tests passed' AS result;
