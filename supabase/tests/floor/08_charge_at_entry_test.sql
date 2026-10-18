-- 101: a floor spray is charged in full when it steps onto the floor; turn end, event end and admin
-- removal of a charged hold move no money; Stop is refused; a failed charge releases the hold and the
-- next person steps up; legacy (pre-101, uncharged) holds keep the time-based settle.
CREATE FUNCTION pg_temp.err(q text) RETURNS text LANGUAGE plpgsql AS $$
BEGIN EXECUTE q; RETURN NULL; EXCEPTION WHEN OTHERS THEN RETURN SQLERRM; END $$;
CREATE TEMP TABLE t (k text PRIMARY KEY, v uuid);

-- A. free slot: charged at queue time, in the same call; idempotent; turn end moves no money.
DO $$
DECLARE host uuid; a uuid; ev uuid; h uuid; r record; w record; wh record;
BEGIN
  host := pg_temp.mk_user('ce-host@test.local', 0);
  a := pg_temp.mk_user('ce-a@test.local', 10000000);
  ev := pg_temp.mk_event(host);
  INSERT INTO t VALUES ('host', host), ('ev', ev);
  h := public.queue_floor_spray(ev, a, 100000, 500, 2);
  SELECT * INTO r FROM public.spray_holds WHERE id = h;
  ASSERT r.status = 'on_floor' AND r.transfer_id IS NOT NULL, format('on floor and charged, got %s/%s', r.status, r.transfer_id);
  ASSERT r.charged_amount_kobo = 100000 AND r.settlement_type = 'full', 'full charge recorded';
  SELECT * INTO w FROM pg_temp.wallet(a);
  ASSERT w.balance = 9900000 AND w.locked = 0, format('sprayer debited, lock returned: %s/%s', w.balance, w.locked);
  SELECT * INTO wh FROM pg_temp.wallet(host);
  ASSERT wh.balance = 100000, 'host credited at entry';
  ASSERT (SELECT count(*) FROM public.spray_records WHERE event_id = ev) = 1, 'one spray record';
  ASSERT (SELECT total_sprayed FROM public.events WHERE id = ev) = 100000, 'event total updated at entry';
  -- mk_user seeds balances without ledger entries, so compare the gap to that seed: the charge itself
  -- must move ledger and balance together (what the every-minute reconcile_wallets checks).
  ASSERT COALESCE((SELECT discrepancy FROM public.reconcile_wallets()
                    WHERE wallet_id = (SELECT id FROM public.wallets WHERE user_id = a AND currency = 'NGN')), 0) = 10000000,
    'sprayer: ledger moved with the balance';
  ASSERT NOT EXISTS (SELECT 1 FROM public.reconcile_wallets()
                      WHERE wallet_id = (SELECT id FROM public.wallets WHERE user_id = host AND currency = 'NGN')),
    'host: ledger matches balance';

  PERFORM public._charge_floor_hold(h);   -- second call: nothing
  SELECT * INTO w FROM pg_temp.wallet(a);
  ASSERT w.balance = 9900000, 'idempotent: no second debit';
  ASSERT pg_temp.err(format('SELECT public._settle_floor_hold(%L, 100000)', h)) = 'Floor spray already charged', '_settle refuses a charged hold';

  UPDATE public.spray_holds SET floor_started_at = now() - interval '61 seconds', floor_ends_at = now() - interval '1 second' WHERE id = h;
  PERFORM public.advance_event_floor(ev);
  SELECT * INTO r FROM public.spray_holds WHERE id = h;
  ASSERT r.status = 'settled' AND r.release_reason IS NULL AND r.settled_at IS NOT NULL, 'turn end: settled';
  SELECT * INTO w FROM pg_temp.wallet(a); SELECT * INTO wh FROM pg_temp.wallet(host);
  ASSERT w.balance = 9900000 AND wh.balance = 100000, 'turn end moved no money';
  ASSERT (SELECT count(*) FROM public.spray_records WHERE event_id = ev) = 1, 'still one spray record';
  ASSERT (SELECT count(*) FROM public.transfers WHERE sender_user_id = a) = 1, 'still one transfer';
END $$;

-- B. queued: only locked; charged in full when promoted. C. leave and max wait release. D. Stop refused.
-- E. admin removal of a charged hold: no money, reason kept, told, audited, next person charged.
DO $$
DECLARE host uuid := (SELECT v FROM t WHERE k = 'host'); ev uuid := (SELECT v FROM t WHERE k = 'ev');
  fills uuid[] := '{}'; f uuid; i int; b uuid; hb uuid; c uuid; hc uuid; d uuid; hd uuid; e uuid; he uuid;
  r record; w record; hb0 bigint; res jsonb; adm uuid;
BEGIN
  FOR i IN 1..8 LOOP
    f := public.queue_floor_spray(ev, pg_temp.mk_user('ce-fill-' || i || '@test.local', 10000000), 20000, 200, 1);
    fills := fills || f;
  END LOOP;
  b := pg_temp.mk_user('ce-b@test.local', 10000000);
  hb := public.queue_floor_spray(ev, b, 100000, 500, 2);
  SELECT * INTO w FROM pg_temp.wallet(b);
  ASSERT (SELECT status FROM public.spray_holds WHERE id = hb) = 'queued', 'b waits';
  ASSERT w.balance = 10000000 AND w.locked = 100000, 'queued: locked, not debited';

  hb0 := (SELECT balance FROM pg_temp.wallet(host));
  UPDATE public.spray_holds SET floor_started_at = now() - interval '61 seconds', floor_ends_at = now() - interval '1 second' WHERE id = fills[1];
  PERFORM public.advance_event_floor(ev);
  SELECT * INTO r FROM public.spray_holds WHERE id = hb;
  ASSERT r.status = 'on_floor' AND r.transfer_id IS NOT NULL, 'b promoted and charged';
  SELECT * INTO w FROM pg_temp.wallet(b);
  ASSERT w.balance = 9900000 AND w.locked = 0, 'b debited at promotion';
  ASSERT (SELECT balance FROM pg_temp.wallet(host)) = hb0 + 100000, 'host credited at promotion';

  c := pg_temp.mk_user('ce-c@test.local', 10000000);
  hc := public.queue_floor_spray(ev, c, 20000, 200, 1);
  PERFORM public.leave_floor_queue(hc, c);
  SELECT * INTO r FROM public.spray_holds WHERE id = hc;
  SELECT * INTO w FROM pg_temp.wallet(c);
  ASSERT r.status = 'released' AND r.release_reason = 'left' AND w.locked = 0 AND w.balance = 10000000, 'leave: free';

  d := pg_temp.mk_user('ce-d@test.local', 10000000);
  hd := public.queue_floor_spray(ev, d, 20000, 200, 1);
  UPDATE public.spray_holds SET expires_at = now() - interval '1 second' WHERE id = hd;
  PERFORM public.advance_event_floor(ev);
  SELECT * INTO r FROM public.spray_holds WHERE id = hd;
  SELECT * INTO w FROM pg_temp.wallet(d);
  ASSERT r.status = 'released' AND r.release_reason = 'max_wait' AND w.locked = 0 AND w.balance = 10000000, 'max wait: free';

  ASSERT pg_temp.err(format('SELECT public.stop_floor_spray(%L, %L)', hb, b)) = 'Sprays can''t be stopped once they start', 'stop refused';
  ASSERT (SELECT status FROM public.spray_holds WHERE id = hb) = 'on_floor', 'stop changed nothing';

  e := pg_temp.mk_user('ce-e@test.local', 10000000);
  he := public.queue_floor_spray(ev, e, 20000, 200, 1);   -- waits behind a full floor
  ASSERT (SELECT status FROM public.spray_holds WHERE id = he) = 'queued', 'e waits';
  adm := (SELECT auth_id FROM public.users WHERE id = host);
  hb0 := (SELECT balance FROM pg_temp.wallet(host));
  res := public.admin_remove_floor_hold(ev, hb, adm, 'Testing removal');
  ASSERT (res->>'already_paid')::boolean AND (res->>'charged_kobo')::bigint = 100000 AND res->>'was_status' = 'on_floor', res::text;
  SELECT * INTO r FROM public.spray_holds WHERE id = hb;
  ASSERT r.status = 'settled' AND r.release_reason = 'removed_by_admin', 'removed: settled with reason';
  -- the host's only change is e's ₦200, paid as e steps into the freed slot
  ASSERT (SELECT balance FROM pg_temp.wallet(b)) = 9900000 AND (SELECT balance FROM pg_temp.wallet(host)) = hb0 + 20000,
    'removal moved no money (host gains only the next dancer''s spray)';
  ASSERT EXISTS (SELECT 1 FROM public.notifications WHERE user_id = b AND type = 'floor_removed'
                 AND body LIKE '%: Testing removal. Your ₦% spray had already gone to the host.'), 'told: already paid';
  ASSERT EXISTS (SELECT 1 FROM public.admin_audit_log WHERE action = 'remove_floor_hold' AND target_id = hb
                 AND (details->>'already_paid')::boolean), 'audited';
  SELECT * INTO r FROM public.spray_holds WHERE id = he;
  ASSERT r.status = 'on_floor' AND r.transfer_id IS NOT NULL, 'next person stepped up and was charged';
END $$;

-- F. a charge that fails at promotion releases the hold (lock returned) and the next person steps up.
DO $$
DECLARE host uuid; ev uuid; fills uuid[] := '{}'; i int; g uuid; hg uuid; k uuid; hk uuid; r record; w record;
BEGIN
  host := pg_temp.mk_user('cf-host@test.local', 0);
  ev := pg_temp.mk_event(host);
  FOR i IN 1..8 LOOP
    fills := fills || public.queue_floor_spray(ev, pg_temp.mk_user('cf-fill-' || i || '@test.local', 10000000), 20000, 200, 1);
  END LOOP;
  g := pg_temp.mk_user('cf-g@test.local', 10000000);
  hg := public.queue_floor_spray(ev, g, 20000, 200, 1);
  k := pg_temp.mk_user('cf-k@test.local', 10000000);
  hk := public.queue_floor_spray(ev, k, 20000, 200, 1);
  UPDATE public.users SET kyc_level = 0 WHERE id = g;      -- debit_wallet refuses level 0
  UPDATE public.spray_holds SET floor_started_at = now() - interval '61 seconds', floor_ends_at = now() - interval '1 second' WHERE id = fills[1];
  PERFORM public.advance_event_floor(ev);                     -- must not raise
  SELECT * INTO r FROM public.spray_holds WHERE id = hg;
  SELECT * INTO w FROM pg_temp.wallet(g);
  ASSERT r.status = 'released' AND r.release_reason = 'charge_failed' AND r.charged_amount_kobo = 0,
    format('charge failed: released, got %s/%s', r.status, r.release_reason);
  ASSERT w.locked = 0 AND w.balance = 10000000, 'lock returned, nothing charged';
  SELECT * INTO r FROM public.spray_holds WHERE id = hk;
  ASSERT r.status = 'on_floor' AND r.floor_slot = 1 AND r.transfer_id IS NOT NULL, 'next person took the slot, charged';
END $$;

-- G. event ends: the charged dancer is settled with no money moving; the queue is released free.
DO $$
DECLARE host uuid; ev uuid; a uuid; ha uuid; q uuid; hq uuid; i int; r record; w record;
BEGIN
  host := pg_temp.mk_user('ee-host@test.local', 0);
  ev := pg_temp.mk_event(host);
  a := pg_temp.mk_user('ee-a@test.local', 10000000);
  ha := public.queue_floor_spray(ev, a, 2000000, 1000, 20);
  FOR i IN 1..7 LOOP PERFORM public.queue_floor_spray(ev, pg_temp.mk_user('ee-' || i || '@test.local', 10000000), 20000, 200, 1); END LOOP;
  q := pg_temp.mk_user('ee-q@test.local', 10000000);
  hq := public.queue_floor_spray(ev, q, 20000, 200, 1);
  UPDATE public.events SET status = 'ended' WHERE id = ev;
  SELECT * INTO r FROM public.spray_holds WHERE id = ha;
  SELECT * INTO w FROM pg_temp.wallet(a);
  ASSERT r.status = 'settled' AND r.release_reason = 'event_ended_on_floor' AND r.charged_amount_kobo = 2000000, 'paid at entry, finished at end';
  ASSERT w.balance = 8000000 AND w.locked = 0, 'no extra money at event end';
  SELECT * INTO r FROM public.spray_holds WHERE id = hq;
  ASSERT r.status = 'released' AND r.release_reason = 'event_ended', 'queue released free';
END $$;

-- H. cutover: a legacy hold (on the floor before 101, never charged) still settles time-based.
DO $$
DECLARE host uuid; ev uuid; a uuid; aw uuid; ha uuid; r record; w record;
BEGIN
  host := pg_temp.mk_user('lg-host@test.local', 0);
  ev := pg_temp.mk_event(host);
  a := pg_temp.mk_user('lg-a@test.local', 10000000);
  aw := (SELECT id FROM public.wallets WHERE user_id = a AND currency = 'NGN');
  UPDATE public.wallets SET locked_balance = 200000 WHERE id = aw;
  INSERT INTO public.spray_holds (event_id, sprayer_id, wallet_id, planned_amount_kobo, denomination, note_count, status, metadata,
                                  expires_at, queued_at, floor_seconds, floor_band_seconds, floor_slot, floor_started_at, floor_ends_at)
  VALUES (ev, a, aw, 200000, 200, 10, 'on_floor', '{"floor": true}', now() + interval '1 hour', now() - interval '2 minutes',
          60, 60, 1, now() - interval '61 seconds', now() - interval '1 second')
  RETURNING id INTO ha;
  PERFORM public.advance_event_floor(ev);
  SELECT * INTO r FROM public.spray_holds WHERE id = ha;
  SELECT * INTO w FROM pg_temp.wallet(a);
  ASSERT r.status = 'settled' AND r.charged_amount_kobo = 200000 AND r.transfer_id IS NOT NULL, 'legacy: charged at turn end';
  ASSERT w.balance = 9800000 AND w.locked = 0, 'legacy: money moved once';
END $$;

-- J. (review Important 1) the charge AND its no-charge fallback both fail (the head of the line has a
-- drifted lock): the advance must still commit — turn ends settle, the bad hold goes back in line
-- untouched, and the people behind it are still promoted and charged.
DO $$
DECLARE host uuid; ev uuid; fills uuid[] := '{}'; i int; g uuid; hg uuid; k uuid; hk uuid; r record;
BEGIN
  host := pg_temp.mk_user('dj-host@test.local', 0);
  ev := pg_temp.mk_event(host);
  FOR i IN 1..8 LOOP
    fills := fills || public.queue_floor_spray(ev, pg_temp.mk_user('dj-fill-' || i || '@test.local', 10000000), 20000, 200, 1);
  END LOOP;
  g := pg_temp.mk_user('dj-g@test.local', 10000000);
  hg := public.queue_floor_spray(ev, g, 20000, 200, 1);
  k := pg_temp.mk_user('dj-k@test.local', 10000000);
  hk := public.queue_floor_spray(ev, k, 20000, 200, 1);
  UPDATE public.wallets SET locked_balance = 0 WHERE user_id = g AND currency = 'NGN';   -- drift: unlock will violate the check
  UPDATE public.spray_holds SET floor_started_at = now() - interval '61 seconds', floor_ends_at = now() - interval '1 second' WHERE id = fills[1];
  PERFORM public.advance_event_floor(ev);                                                -- must not raise
  ASSERT (SELECT status FROM public.spray_holds WHERE id = fills[1]) = 'settled', 'turn end still committed';
  SELECT * INTO r FROM public.spray_holds WHERE id = hg;
  ASSERT r.status = 'queued' AND r.floor_slot IS NULL AND r.floor_started_at IS NULL AND r.transfer_id IS NULL,
    format('bad hold back in line untouched, got %s/%s', r.status, r.floor_slot);
  SELECT * INTO r FROM public.spray_holds WHERE id = hk;
  ASSERT r.status = 'on_floor' AND r.floor_slot = 1 AND r.transfer_id IS NOT NULL, 'the next person was promoted and charged';
END $$;

-- I. grants
DO $$
DECLARE r text; f text;
BEGIN
  FOREACH r IN ARRAY ARRAY['anon', 'authenticated'] LOOP
    FOREACH f IN ARRAY ARRAY['public._charge_floor_hold(uuid)', 'public._finish_floor_turn(uuid,text)', 'public._floor_try_charge(uuid)'] LOOP
      ASSERT NOT has_function_privilege(r, f::regprocedure, 'execute'), r || ' must not execute ' || f;
    END LOOP;
  END LOOP;
  ASSERT has_function_privilege('service_role', 'public._charge_floor_hold(uuid)'::regprocedure, 'execute'), 'svc charge';
  ASSERT has_function_privilege('service_role', 'public._finish_floor_turn(uuid,text)'::regprocedure, 'execute'), 'svc finish';
  ASSERT has_function_privilege('service_role', 'public._floor_try_charge(uuid)'::regprocedure, 'execute'), 'svc try';
END $$;

SELECT 'charge at entry tests passed' AS result;
