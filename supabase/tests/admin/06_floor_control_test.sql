-- 100: admins can remove one spray from the floor or the queue using the floor's own settle rules
-- (queued: no charge; on the floor: charged for the time danced, paid to the host), the next person
-- steps up, the sprayer is told, and it's audited. Also: admin_advance_floor. Service_role only.

CREATE FUNCTION pg_temp.err(q text) RETURNS text LANGUAGE plpgsql AS $$
BEGIN EXECUTE q; RETURN NULL; EXCEPTION WHEN OTHERS THEN RETURN SQLERRM; END $$;

CREATE TEMP TABLE fx AS
SELECT a.id AS a_id, (SELECT id FROM public.wallets WHERE user_id = a.id AND currency = 'NGN') AS a_wallet,
       b.id AS b_id, b.auth_id AS admin_auth, (SELECT id FROM public.wallets WHERE user_id = b.id AND currency = 'NGN') AS b_wallet
FROM public.users a, public.users b
WHERE a.id = '53f63182-22be-4f1f-aa78-c24d52ad4f3d' AND b.id = '17df71bf-bd30-4632-aafd-f111d792762b';
-- spray debits and receive credits refuse KYC level 0
UPDATE public.users SET kyc_level = 1 WHERE id IN ((SELECT a_id FROM fx), (SELECT b_id FROM fx));

-- Event 1 (host: B): A dancing (turn started 30 s ago, 60 s long), B queued behind.
-- Event 2 (host: B): A queued only.
INSERT INTO public.events (host_id, title, type, status, started_at)
SELECT b_id, v.t, 'other', 'live', now() - interval '5 minutes' FROM fx CROSS JOIN (VALUES ('Test 100 one'), ('Test 100 two')) AS v(t);
CREATE TEMP TABLE ev AS SELECT title, id FROM public.events WHERE title IN ('Test 100 one', 'Test 100 two');

-- Each hold locks its planned amount, as queue_floor_spray does: 10 notes of ₦200 = 200,000 kobo.
UPDATE public.wallets SET balance = balance + 400000, locked_balance = locked_balance + 400000 WHERE id = (SELECT a_wallet FROM fx);
UPDATE public.wallets SET balance = balance + 200000, locked_balance = locked_balance + 200000 WHERE id = (SELECT b_wallet FROM fx);

INSERT INTO public.spray_holds (event_id, sprayer_id, wallet_id, planned_amount_kobo, denomination, note_count, status,
                                expires_at, queued_at, floor_seconds, floor_band_seconds, floor_slot, floor_started_at, floor_ends_at)
SELECT (SELECT id FROM ev WHERE title = 'Test 100 one'), a_id, a_wallet, 200000, 200, 10, 'on_floor'::public.spray_hold_status,
       now() + interval '1 hour', now() - interval '2 minutes', 60, 60, 1::smallint, now() - interval '30 seconds', now() + interval '30 seconds' FROM fx
UNION ALL
SELECT (SELECT id FROM ev WHERE title = 'Test 100 one'), b_id, b_wallet, 200000, 200, 10, 'queued'::public.spray_hold_status,
       now() + interval '1 hour', now() - interval '1 minute', 60, 60, NULL::smallint, NULL::timestamptz, NULL::timestamptz FROM fx
UNION ALL
SELECT (SELECT id FROM ev WHERE title = 'Test 100 two'), a_id, a_wallet, 200000, 200, 10, 'queued'::public.spray_hold_status,
       now() + interval '1 hour', now() - interval '1 minute', 60, 60, NULL::smallint, NULL::timestamptz, NULL::timestamptz FROM fx;

CREATE TEMP TABLE h AS
SELECT s.id, s.event_id, s.sprayer_id, s.status::text AS st, e.title FROM public.spray_holds s JOIN ev e ON e.id = s.event_id
WHERE s.event_id IN (SELECT id FROM ev);
CREATE TEMP TABLE w0 AS SELECT
  (SELECT balance FROM public.wallets WHERE id = (SELECT a_wallet FROM fx)) AS a_bal,
  (SELECT locked_balance FROM public.wallets WHERE id = (SELECT a_wallet FROM fx)) AS a_lock,
  (SELECT balance FROM public.wallets WHERE id = (SELECT b_wallet FROM fx)) AS b_bal;

DO $$
DECLARE
  adm uuid := (SELECT admin_auth FROM fx);
  a uuid := (SELECT a_id FROM fx);
  on_floor uuid := (SELECT id FROM h WHERE title = 'Test 100 one' AND st = 'on_floor');
  queued_b uuid := (SELECT id FROM h WHERE title = 'Test 100 one' AND st = 'queued');
  queued_a2 uuid := (SELECT id FROM h WHERE title = 'Test 100 two');
  q text := 'SELECT public.admin_remove_floor_hold(%L, %L, %L)';
  r jsonb; expected bigint; w record;
BEGIN
  SELECT * INTO w FROM w0;
  ASSERT pg_temp.err(format(q, gen_random_uuid(), adm, 'x')) = 'Spray hold not found', 'missing';
  ASSERT pg_temp.err(format(q, on_floor, adm, '  ')) = 'A reason is required', 'blank reason';
  ASSERT pg_temp.err(format(q, on_floor, adm, repeat('x', 501))) = 'Keep the reason under 500 characters', 'reason capped';

  -- queued (event 2): released, no charge, lock returned
  r := public.admin_remove_floor_hold(queued_a2, adm, 'Spamming the room');
  ASSERT (r->>'charged_kobo')::bigint = 0 AND r->>'was_status' = 'queued', 'queued: no charge';
  ASSERT (SELECT status::text FROM public.spray_holds WHERE id = queued_a2) = 'released', 'released';
  ASSERT (SELECT release_reason FROM public.spray_holds WHERE id = queued_a2) = 'removed_by_admin', 'reason code';
  ASSERT (SELECT locked_balance FROM public.wallets WHERE id = (SELECT a_wallet FROM fx)) = w.a_lock - 200000, 'lock returned';
  ASSERT (SELECT balance FROM public.wallets WHERE id = (SELECT a_wallet FROM fx)) = w.a_bal, 'no charge';

  -- on the floor (event 1): charged for the time danced, host paid, next person promoted
  expected := public.floor_charged_kobo(10, 200, 60,
    public._floor_elapsed_ms((SELECT floor_started_at FROM public.spray_holds WHERE id = on_floor)));
  r := public.admin_remove_floor_hold(on_floor, adm, 'Offensive avatar.');
  ASSERT r->>'was_status' = 'on_floor', 'was on floor';
  -- the elapsed time keeps moving inside the transaction, so allow one note of drift
  ASSERT (r->>'charged_kobo')::bigint BETWEEN expected AND expected + 20000, 'charged for the time danced: ' || r::text;
  ASSERT (r->>'charged_kobo')::bigint > 0, 'something was charged after 30 s';
  ASSERT (SELECT balance FROM public.wallets WHERE id = (SELECT a_wallet FROM fx)) = w.a_bal - (r->>'charged_kobo')::bigint, 'sprayer charged exactly';
  ASSERT (SELECT locked_balance FROM public.wallets WHERE id = (SELECT a_wallet FROM fx)) = w.a_lock - 400000, 'both locks returned';
  ASSERT (SELECT balance FROM public.wallets WHERE id = (SELECT b_wallet FROM fx)) = w.b_bal + (r->>'charged_kobo')::bigint, 'host paid exactly';
  ASSERT (SELECT release_reason FROM public.spray_holds WHERE id = on_floor) = 'removed_by_admin', 'reason code on settled hold';
  ASSERT (SELECT status::text FROM public.spray_holds WHERE id = queued_b) = 'on_floor', 'next person stepped up';
  ASSERT pg_temp.err(format(q, on_floor, adm, 'again')) = 'This spray isn''t on the floor or in the queue', 'settled hold refused';

  -- told and audited
  ASSERT EXISTS (SELECT 1 FROM public.notifications WHERE user_id = a AND type = 'floor_removed'
                 AND body LIKE '%"Test 100 two": Spamming the room. You weren''t charged.'), 'queued: no-charge notice';
  ASSERT EXISTS (SELECT 1 FROM public.notifications WHERE user_id = a AND type = 'floor_removed'
                 AND body LIKE '%"Test 100 one": Offensive avatar. You were charged ₦% for the time you danced.'
                 AND (data->>'charged_kobo')::bigint = (r->>'charged_kobo')::bigint), 'on-floor: charge notice';
  ASSERT (SELECT count(*) FROM public.admin_audit_log WHERE action = 'remove_floor_hold' AND admin_user_id = adm
          AND target_id IN (on_floor, queued_a2)) = 2, 'audited';

  -- advance floor
  ASSERT pg_temp.err(format('SELECT public.admin_advance_floor(%L, %L)', gen_random_uuid(), adm)) = 'Event not found', 'unknown event';
  r := public.admin_advance_floor((SELECT id FROM ev WHERE title = 'Test 100 one'), adm);
  ASSERT (r->>'on_floor')::int = 1 AND (r->>'queued')::int = 0, 'counts after advance: ' || r::text;
  ASSERT EXISTS (SELECT 1 FROM public.admin_audit_log WHERE action = 'advance_floor' AND admin_user_id = adm), 'advance audited';
END $$;

DO $$
DECLARE r text; f text;
BEGIN
  FOREACH r IN ARRAY ARRAY['anon', 'authenticated'] LOOP
    FOREACH f IN ARRAY ARRAY['public.admin_remove_floor_hold(uuid,uuid,text)', 'public.admin_advance_floor(uuid,uuid)'] LOOP
      ASSERT NOT has_function_privilege(r, f::regprocedure, 'execute'), r || ' must not execute ' || f;
    END LOOP;
  END LOOP;
  ASSERT has_function_privilege('service_role', 'public.admin_remove_floor_hold(uuid,uuid,text)'::regprocedure, 'execute'), 'svc remove';
  ASSERT has_function_privilege('service_role', 'public.admin_advance_floor(uuid,uuid)'::regprocedure, 'execute'), 'svc advance';
END $$;

SELECT 'floor control tests passed' AS result;
