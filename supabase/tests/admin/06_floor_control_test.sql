-- 100: admins can remove one spray from a LIVE event's floor or queue using the floor's own settle rules
-- (queued: no charge; on the floor: charged for the time danced — never more than planned — paid to
-- the host), the next person steps up, the sprayer is told, and it's audited. The hold must belong to
-- the given event, and an ended event is refused (its floor settles automatically, to its end time).
-- Also: admin_advance_floor. Service_role only.

CREATE FUNCTION pg_temp.err(q text) RETURNS text LANGUAGE plpgsql AS $$
BEGIN EXECUTE q; RETURN NULL; EXCEPTION WHEN OTHERS THEN RETURN SQLERRM; END $$;

-- Sprayers A and B (the two internal stand-ins); the host is the internal treasury account (a host
-- can't queue at their own event), and B's auth user stands in for the admin.
CREATE TEMP TABLE fx AS
SELECT a.id AS a_id, (SELECT id FROM public.wallets WHERE user_id = a.id AND currency = 'NGN') AS a_wallet,
       b.id AS b_id, b.auth_id AS admin_auth, (SELECT id FROM public.wallets WHERE user_id = b.id AND currency = 'NGN') AS b_wallet,
       t.id AS host_id, (SELECT id FROM public.wallets WHERE user_id = t.id AND currency = 'NGN') AS host_wallet
FROM public.users a, public.users b, public.users t
WHERE a.id = '53f63182-22be-4f1f-aa78-c24d52ad4f3d' AND b.id = '17df71bf-bd30-4632-aafd-f111d792762b'
  AND t.id = '00000000-0000-4000-8000-000000000001';
-- spray debits refuse KYC level 0
UPDATE public.users SET kyc_level = GREATEST(kyc_level, 1) WHERE id IN ((SELECT a_id FROM fx), (SELECT b_id FROM fx));

INSERT INTO public.events (host_id, title, type, status, started_at, ended_at)
SELECT host_id, v.t, 'other', v.st::public.event_status, now() - interval '10 minutes', v.ended
FROM fx CROSS JOIN (VALUES
  ('T100 floor',   'live',  NULL::timestamptz),
  ('T100 queue',   'live',  NULL::timestamptz),
  ('T100 overdue', 'live',  NULL::timestamptz),
  ('T100 zero',    'live',  NULL::timestamptz),
  ('T100 ended',   'ended', now() - interval '1 minute')
) AS v(t, st, ended);
CREATE TEMP TABLE ev AS SELECT title, id FROM public.events WHERE title LIKE 'T100 %';

-- Each hold locks its planned amount (10 notes of ₦200 = 200,000 kobo), as queue_floor_spray does.
UPDATE public.wallets SET balance = balance + 600000, locked_balance = locked_balance + 600000 WHERE id = (SELECT a_wallet FROM fx);
UPDATE public.wallets SET balance = balance + 600000, locked_balance = locked_balance + 600000 WHERE id = (SELECT b_wallet FROM fx);

INSERT INTO public.spray_holds (event_id, sprayer_id, wallet_id, planned_amount_kobo, denomination, note_count, status,
                                expires_at, queued_at, floor_seconds, floor_band_seconds, floor_slot, floor_started_at, floor_ends_at)
SELECT (SELECT id FROM ev WHERE title = v.ev), CASE v.who WHEN 'a' THEN fx.a_id ELSE fx.b_id END,
       CASE v.who WHEN 'a' THEN fx.a_wallet ELSE fx.b_wallet END, 200000, 200, 10, v.st::public.spray_hold_status,
       now() + interval '1 hour', now() - interval '3 minutes', 60, 60, v.slot,
       CASE WHEN v.started IS NULL THEN NULL ELSE now() - v.started END,
       CASE WHEN v.started IS NULL THEN NULL ELSE now() - v.started + interval '60 seconds' END
FROM fx CROSS JOIN (VALUES
  ('T100 floor',   'a', 'on_floor', 1::smallint,    interval '30 seconds'),
  ('T100 floor',   'b', 'queued',   NULL::smallint, NULL::interval),
  ('T100 queue',   'a', 'queued',   NULL::smallint, NULL::interval),
  ('T100 overdue', 'b', 'on_floor', 1::smallint,    interval '90 seconds'),
  ('T100 zero',    'a', 'on_floor', 1::smallint,    interval '0 seconds'),
  ('T100 ended',   'b', 'on_floor', 1::smallint,    interval '20 seconds')
) AS v(ev, who, st, slot, started);

CREATE TEMP TABLE h AS
SELECT s.id, s.event_id, e.title, s.sprayer_id FROM public.spray_holds s JOIN ev e ON e.id = s.event_id;

CREATE FUNCTION pg_temp.bal(w uuid) RETURNS bigint LANGUAGE sql AS $$ SELECT balance FROM public.wallets WHERE id = w $$;
CREATE FUNCTION pg_temp.lck(w uuid) RETURNS bigint LANGUAGE sql AS $$ SELECT locked_balance FROM public.wallets WHERE id = w $$;

DO $$
DECLARE
  adm uuid := (SELECT admin_auth FROM fx);
  a uuid := (SELECT a_id FROM fx);
  aw uuid := (SELECT a_wallet FROM fx); bw uuid := (SELECT b_wallet FROM fx); hw uuid := (SELECT host_wallet FROM fx);
  e_floor uuid := (SELECT id FROM ev WHERE title = 'T100 floor');
  e_queue uuid := (SELECT id FROM ev WHERE title = 'T100 queue');
  e_over uuid := (SELECT id FROM ev WHERE title = 'T100 overdue');
  e_zero uuid := (SELECT id FROM ev WHERE title = 'T100 zero');
  e_end uuid := (SELECT id FROM ev WHERE title = 'T100 ended');
  h_floor uuid := (SELECT id FROM h WHERE title = 'T100 floor' AND sprayer_id = a);
  h_next uuid := (SELECT id FROM h WHERE title = 'T100 floor' AND sprayer_id <> a);
  h_queue uuid := (SELECT id FROM h WHERE title = 'T100 queue');
  h_over uuid := (SELECT id FROM h WHERE title = 'T100 overdue');
  h_zero uuid := (SELECT id FROM h WHERE title = 'T100 zero');
  h_end uuid := (SELECT id FROM h WHERE title = 'T100 ended');
  q text := 'SELECT public.admin_remove_floor_hold(%L, %L, %L, %L)';
  r jsonb; expected bigint; ab bigint; al bigint; bb bigint; bl bigint; hb bigint;
BEGIN
  -- guards
  ASSERT pg_temp.err(format(q, e_floor, gen_random_uuid(), adm, 'x')) = 'Spray hold not found', 'missing';
  ASSERT pg_temp.err(format(q, e_queue, h_floor, adm, 'x')) = 'Spray hold not found in this event', 'other event refused';
  ASSERT pg_temp.err(format(q, e_end, h_end, adm, 'x')) = 'The event has ended; its floor settles automatically', 'ended event refused';
  ASSERT (SELECT status::text FROM public.spray_holds WHERE id = h_end) = 'on_floor', 'ended-event hold untouched';
  ASSERT pg_temp.err(format(q, e_floor, h_floor, adm, '  ')) = 'A reason is required', 'blank reason';
  ASSERT pg_temp.err(format(q, e_floor, h_floor, adm, repeat('x', 501))) = 'Keep the reason under 500 characters', 'reason capped';

  -- queued: released, no charge, lock returned
  al := pg_temp.lck(aw); ab := pg_temp.bal(aw);
  r := public.admin_remove_floor_hold(e_queue, h_queue, adm, 'Spamming the room');
  ASSERT (r->>'charged_kobo')::bigint = 0 AND r->>'was_status' = 'queued', 'queued: no charge';
  ASSERT (SELECT status::text || '/' || settlement_type::text || '/' || release_reason FROM public.spray_holds WHERE id = h_queue)
         = 'released/cancelled/removed_by_admin', 'queued: released, cancelled, reason kept';
  ASSERT pg_temp.lck(aw) = al - 200000 AND pg_temp.bal(aw) = ab, 'queued: lock returned, nothing charged';

  -- on the floor 30 s into a 60 s turn: charged for the time danced, host paid, next person promoted
  al := pg_temp.lck(aw); ab := pg_temp.bal(aw); hb := pg_temp.bal(hw);
  expected := public.floor_charged_kobo(10, 200, 60,
    public._floor_elapsed_ms((SELECT floor_started_at FROM public.spray_holds WHERE id = h_floor)));
  r := public.admin_remove_floor_hold(e_floor, h_floor, adm, 'Offensive avatar.');
  ASSERT r->>'was_status' = 'on_floor', 'was on floor';
  ASSERT (r->>'charged_kobo')::bigint = expected AND expected > 0, 'charged for the time danced: ' || r::text;
  ASSERT pg_temp.bal(aw) = ab - expected AND pg_temp.lck(aw) = al - 200000, 'sprayer charged exactly, lock returned';
  -- plus the next person's full spray, paid as they step into the freed slot (101)
  ASSERT pg_temp.bal(hw) = hb + expected + 200000, 'host paid exactly: the time danced, then the next spray in full';
  ASSERT (SELECT release_reason FROM public.spray_holds WHERE id = h_floor) = 'removed_by_admin', 'reason on settled hold';
  ASSERT (SELECT status::text FROM public.spray_holds WHERE id = h_next) = 'on_floor', 'next person stepped up';
  ASSERT pg_temp.err(format(q, e_floor, h_floor, adm, 'again')) = 'This spray isn''t on the floor or in the queue', 'settled hold refused';

  -- overdue turn (90 s into 60 s): charged the full planned amount, never more
  bl := pg_temp.lck(bw); bb := pg_temp.bal(bw); hb := pg_temp.bal(hw);
  r := public.admin_remove_floor_hold(e_over, h_over, adm, 'Wrong room');
  ASSERT (r->>'charged_kobo')::bigint = 200000, 'overdue: exactly the planned amount';
  ASSERT (SELECT settlement_type::text FROM public.spray_holds WHERE id = h_over) = 'full', 'overdue: full settlement';
  ASSERT pg_temp.bal(bw) = bb - 200000 AND pg_temp.lck(bw) = bl - 200000 AND pg_temp.bal(hw) = hb + 200000, 'overdue: money moved exactly';

  -- just started (0 s danced): no charge, released with the reason kept
  al := pg_temp.lck(aw); ab := pg_temp.bal(aw);
  r := public.admin_remove_floor_hold(e_zero, h_zero, adm, 'Duplicate account');
  ASSERT (r->>'charged_kobo')::bigint = 0, 'zero: nothing danced, nothing charged';
  ASSERT (SELECT status::text || '/' || release_reason FROM public.spray_holds WHERE id = h_zero) = 'released/removed_by_admin', 'zero: released, reason kept';
  ASSERT pg_temp.bal(aw) = ab AND pg_temp.lck(aw) = al - 200000, 'zero: lock returned';

  -- told and audited
  ASSERT EXISTS (SELECT 1 FROM public.notifications WHERE user_id = a AND type = 'floor_removed'
                 AND body LIKE '%"T100 queue": Spamming the room. You weren''t charged.'), 'queued: no-charge notice';
  ASSERT EXISTS (SELECT 1 FROM public.notifications WHERE user_id = a AND type = 'floor_removed'
                 AND body LIKE '%"T100 floor": Offensive avatar. You were charged ₦% for the time you danced.'
                 AND (data->>'charged_kobo')::bigint = expected), 'on-floor: charge notice';
  ASSERT (SELECT count(*) FROM public.admin_audit_log WHERE action = 'remove_floor_hold' AND admin_user_id = adm
          AND target_id IN (h_queue, h_floor, h_over, h_zero)) = 4, 'audited';

  -- advance floor
  ASSERT pg_temp.err(format('SELECT public.admin_advance_floor(%L, %L)', gen_random_uuid(), adm)) = 'Event not found', 'unknown event';
  r := public.admin_advance_floor(e_floor, adm);
  ASSERT (r->>'on_floor')::int = 1 AND (r->>'queued')::int = 0, 'counts after advance: ' || r::text;
  ASSERT EXISTS (SELECT 1 FROM public.admin_audit_log WHERE action = 'advance_floor' AND admin_user_id = adm), 'advance audited';
END $$;

DO $$
DECLARE r text; f text;
BEGIN
  FOREACH r IN ARRAY ARRAY['anon', 'authenticated'] LOOP
    FOREACH f IN ARRAY ARRAY['public.admin_remove_floor_hold(uuid,uuid,uuid,text)', 'public.admin_advance_floor(uuid,uuid)'] LOOP
      ASSERT NOT has_function_privilege(r, f::regprocedure, 'execute'), r || ' must not execute ' || f;
    END LOOP;
  END LOOP;
  ASSERT has_function_privilege('service_role', 'public.admin_remove_floor_hold(uuid,uuid,uuid,text)'::regprocedure, 'execute'), 'svc remove';
  ASSERT has_function_privilege('service_role', 'public.admin_advance_floor(uuid,uuid)'::regprocedure, 'execute'), 'svc advance';
END $$;

SELECT 'floor control tests passed' AS result;
