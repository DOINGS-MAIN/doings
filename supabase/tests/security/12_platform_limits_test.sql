-- 115: every amount limit is a setting an admin can change, and sprays have a daily allowance.
-- Run as: BEGIN; migrations 113, 114, 115; tests/ads/_setup.sql; this file; ROLLBACK.

CREATE FUNCTION pg_temp.as_user(p_user uuid, q text) RETURNS text LANGUAGE plpgsql AS $$
DECLARE v text;
BEGIN
  PERFORM pg_temp.auth_as(p_user);
  SET LOCAL ROLE authenticated;
  BEGIN EXECUTE q INTO v; EXCEPTION WHEN OTHERS THEN RESET ROLE; RETURN SQLERRM; END;
  RESET ROLE; RETURN COALESCE(v, 'OK');
END $$;

CREATE FUNCTION pg_temp.mk_live_event(p_host uuid) RETURNS uuid LANGUAGE sql AS $$
  INSERT INTO public.events (host_id, title, type, event_code, status, is_private)
  VALUES (p_host, 'Sec 115', 'party', upper(substr(md5(random()::text), 1, 6)), 'live', false) RETURNING id
$$;

-- p_notes notes of N200: 20,000 kobo each
CREATE FUNCTION pg_temp.floor_spray(p_event uuid, p_user uuid, p_notes int) RETURNS text LANGUAGE plpgsql AS $$
BEGIN
  PERFORM public.queue_floor_spray(p_event, p_user, p_notes::bigint * 20000, 200, p_notes);
  RETURN 'OK';
EXCEPTION WHEN OTHERS THEN RETURN SQLERRM;
END $$;

CREATE FUNCTION pg_temp.give(p_user uuid, p_total bigint, p_each bigint) RETURNS text LANGUAGE plpgsql AS $$
BEGIN
  PERFORM public.create_giveaway_funded(p_user, 's115', p_total, p_each, 'scheduled'::public.giveaway_type);
  RETURN 'OK';
EXCEPTION WHEN OTHERS THEN RETURN SQLERRM;
END $$;

-- ── sprays: a daily allowance by level, across every way of spraying ──
DO $$
DECLARE
  host uuid := pg_temp.mk_user('s115-host@test.local', 0);
  host2 uuid := pg_temp.mk_user('s115-host2@test.local', 0);
  l1 uuid := pg_temp.mk_user('s115-l1@test.local', 1000000000);
  l2 uuid := pg_temp.mk_user('s115-l2@test.local', 1000000000);
  ev uuid := pg_temp.mk_live_event(host);
  ev2 uuid := pg_temp.mk_live_event(host2);
  bal bigint; r text; waiting uuid;
BEGIN
  ASSERT (SELECT spray_daily_limit_l1_kobo FROM public.platform_settings WHERE id = 1) = 100000000, 'email-only sprays ship at N1,000,000 a day';
  ASSERT (SELECT spray_daily_limit_l2_kobo FROM public.platform_settings WHERE id = 1) = 500000000, 'verified sprays ship at N5,000,000 a day';

  UPDATE public.users SET kyc_level = 2 WHERE id = l2;
  -- N1,000 a day for email-only, N2,000 for verified
  UPDATE public.platform_settings SET spray_daily_limit_l1_kobo = 100000, spray_daily_limit_l2_kobo = 200000 WHERE id = 1;

  -- a spray waiting in the line counts before it is charged
  ASSERT pg_temp.floor_spray(ev, l1, 3) = 'OK', 'N600 inside the limit';
  SELECT balance - locked_balance INTO bal FROM public.wallets WHERE user_id = l1 AND currency = 'NGN';
  r := pg_temp.floor_spray(ev2, l1, 3);
  ASSERT r = 'SPRAY_DAILY_LIMIT 40000', 'N600 more is over, and says what is left: ' || r;
  ASSERT (SELECT balance - locked_balance FROM public.wallets WHERE user_id = l1 AND currency = 'NGN') = bal, 'a refused spray holds nothing';
  -- a spray waiting in the line (not charged yet) counts too
  INSERT INTO public.spray_holds (event_id, sprayer_id, wallet_id, planned_amount_kobo, denomination, note_count, status, expires_at)
    VALUES (ev2, l1, (SELECT id FROM public.wallets WHERE user_id = l1 AND currency = 'NGN'), 40000, 200, 2, 'pending', now() + interval '1 hour')
    RETURNING id INTO waiting;
  BEGIN
    PERFORM public.record_event_spray(ev, l1, 20000, 200, 1, '{}'::jsonb); r := 'OK';
  EXCEPTION WHEN OTHERS THEN r := SQLERRM; END;
  ASSERT r = 'SPRAY_DAILY_LIMIT 0', 'a waiting spray uses the allowance: ' || r;

  -- let go without being charged, it gives the allowance back
  UPDATE public.spray_holds SET status = 'released' WHERE id = waiting;
  BEGIN
    PERFORM public.record_event_spray(ev, l1, 40000, 200, 2, '{}'::jsonb); r := 'OK';
  EXCEPTION WHEN OTHERS THEN r := SQLERRM; END;
  ASSERT r = 'OK', 'a released hold no longer counts, so exactly up to the limit is allowed: ' || r;

  -- the direct spray path counts against the same allowance
  BEGIN
    PERFORM public.record_event_spray(ev, l1, 20000, 200, 1, '{}'::jsonb); r := 'OK';
  EXCEPTION WHEN OTHERS THEN r := SQLERRM; END;
  ASSERT r = 'SPRAY_DAILY_LIMIT 0', 'direct spray over the limit: ' || r;
  -- and the classic hold path
  BEGIN
    PERFORM public.create_spray_hold(ev, l1, 20000, 200, 1, '{}'::jsonb, 60); r := 'OK';
  EXCEPTION WHEN OTHERS THEN r := SQLERRM; END;
  ASSERT r = 'SPRAY_DAILY_LIMIT 0', 'classic hold over the limit: ' || r;

  -- a charged spray counts once (its transaction), not twice (transaction + hold)
  ASSERT pg_temp.floor_spray(ev, l2, 5) = 'OK', 'verified person: N1,000 of N2,000';
  BEGIN
    PERFORM public.record_event_spray(ev2, l2, 100000, 200, 5, '{}'::jsonb); r := 'OK';
  EXCEPTION WHEN OTHERS THEN r := SQLERRM; END;
  ASSERT r = 'OK', 'a charged N1,000 on top reaches exactly N2,000: ' || r;
  r := pg_temp.floor_spray(ev2, l2, 1);
  ASSERT r = 'SPRAY_DAILY_LIMIT 0', 'verified limit reached: ' || r;

  -- a spray that waited across midnight belongs to the day it joined the line, not to both days
  UPDATE public.platform_settings SET spray_daily_limit_l2_kobo = 1000000 WHERE id = 1;
  INSERT INTO public.spray_holds (event_id, sprayer_id, wallet_id, planned_amount_kobo, denomination, note_count, status, expires_at, created_at)
    VALUES (ev2, l2, (SELECT id FROM public.wallets WHERE user_id = l2 AND currency = 'NGN'), 600000, 200, 30, 'settled', now() + interval '1 hour', now() - interval '25 hours')
    RETURNING id INTO waiting;
  INSERT INTO public.transactions (user_id, wallet_id, type, amount, fee, net_amount, currency, status, description, metadata, idempotency_key)
    SELECT l2, id, 'spray', -600000, 0, -600000, 'NGN', 'completed', 's115 charged after midnight', jsonb_build_object('hold_id', waiting), 's115-' || gen_random_uuid()::text
      FROM public.wallets WHERE user_id = l2 AND currency = 'NGN';
  BEGIN
    PERFORM public.record_event_spray(ev, l2, 800000, 200, 40, '{}'::jsonb); r := 'OK';
  EXCEPTION WHEN OTHERS THEN r := SQLERRM; END;
  ASSERT r = 'OK', 'yesterday''s spray charged today does not use today''s allowance (N2,000 already used + N8,000 = N10,000): ' || r;
  UPDATE public.platform_settings SET spray_daily_limit_l2_kobo = 200000 WHERE id = 1;
  UPDATE public.transactions SET created_at = now() - interval '25 hours' WHERE user_id = l2 AND type = 'spray';

  -- a spray whose time in the line has run out no longer holds allowance, even before it is tidied away
  INSERT INTO public.spray_holds (event_id, sprayer_id, wallet_id, planned_amount_kobo, denomination, note_count, status, expires_at)
    VALUES (ev2, l2, (SELECT id FROM public.wallets WHERE user_id = l2 AND currency = 'NGN'), 200000, 200, 10, 'pending', now() - interval '1 minute');
  UPDATE public.spray_holds SET created_at = now() - interval '25 hours' WHERE sprayer_id = l2 AND status <> 'pending';
  BEGIN
    PERFORM public.record_event_spray(ev, l2, 20000, 200, 1, '{}'::jsonb); r := 'OK';
  EXCEPTION WHEN OTHERS THEN r := SQLERRM; END;
  ASSERT r = 'OK', 'an expired hold is not counted: ' || r;

  -- yesterday does not count
  UPDATE public.spray_holds SET created_at = now() - interval '25 hours' WHERE sprayer_id = l2;
  UPDATE public.transactions SET created_at = now() - interval '25 hours' WHERE user_id = l2 AND type = 'spray';
  ASSERT pg_temp.floor_spray(ev2, l2, 1) = 'OK', 'a new day, a new allowance';
END $$;

-- ── giveaway minimums come from settings ──
DO $$
DECLARE u uuid := pg_temp.mk_user('s115-give@test.local', 1000000000); r text;
BEGIN
  ASSERT (SELECT giveaway_min_total_kobo = 10000 AND giveaway_min_per_person_kobo = 1000 FROM public.platform_settings WHERE id = 1), 'minimums ship as they were: 100 and 10 bundles';
  r := pg_temp.give(u, 5000, 5000);
  ASSERT r = 'Minimum total is 100 bundles', 'default minimum total: ' || r;
  r := pg_temp.give(u, 10000, 500);
  ASSERT r = 'Minimum per person is 10 bundles', 'default minimum each: ' || r;
  UPDATE public.platform_settings SET giveaway_min_total_kobo = 50000, giveaway_min_per_person_kobo = 5000 WHERE id = 1;
  r := pg_temp.give(u, 10000, 1000);
  ASSERT r = 'Minimum total is 500 bundles', 'raised minimum total: ' || r;
  r := pg_temp.give(u, 50000, 1000);
  ASSERT r = 'Minimum per person is 50 bundles', 'raised minimum each: ' || r;
  ASSERT pg_temp.give(u, 50000, 5000) = 'OK', 'at the new minimums';
END $$;

-- ── who may read and set ──
DO $$
DECLARE
  boss uuid := pg_temp.mk_admin('s115-boss@test.local', 'super_admin');
  fin uuid := pg_temp.mk_admin('s115-fin@test.local', 'finance');
  someone uuid := pg_temp.mk_user('s115-someone@test.local', 0);
  boss_auth uuid := (SELECT auth_id FROM public.users WHERE id = boss);
  -- min purchase, min sale (bundles); daily sale, largest spray, spray daily l1, l2, giveaway min total, min each (kobo)
  setq text := 'SELECT public.set_platform_limits(%s, %s, %s, %s, %s, %s, %s, %s)::text'; r text; j jsonb;
BEGIN
  ASSERT NOT has_function_privilege('anon', 'public.set_platform_limits(bigint, bigint, bigint, bigint, bigint, bigint, bigint, bigint)', 'EXECUTE'), 'signed out cannot set';
  ASSERT NOT has_function_privilege('anon', 'public.app_limits()', 'EXECUTE'), 'signed out cannot read';

  r := pg_temp.as_user(someone, format(setq, 1000, 1000, 200000000, 100000000, 100000000, 500000000, 10000, 1000));
  ASSERT r = 'Only super admins can change limits', 'an ordinary person: ' || r;
  r := pg_temp.as_user(fin, format(setq, 1000, 1000, 200000000, 100000000, 100000000, 500000000, 10000, 1000));
  ASSERT r = 'Only super admins can change limits', 'a finance admin: ' || r;
  r := pg_temp.as_user(someone, 'SELECT public.get_platform_limits()::text');
  ASSERT r = 'Only admins can read limits', 'an ordinary person cannot read the admin view: ' || r;

  r := pg_temp.as_user(boss, format(setq, 0, 1000, 200000000, 100000000, 100000000, 500000000, 10000, 1000));
  ASSERT r = 'A minimum must be at least 1', 'zero minimum: ' || r;
  r := pg_temp.as_user(boss, format(setq, 1000, 1000, -1, 100000000, 100000000, 500000000, 10000, 1000));
  ASSERT r = 'A limit cannot be negative', 'negative: ' || r;
  r := pg_temp.as_user(boss, format(setq, 1000, 1000, 200000000, 100000000, 500000000, 100000000, 10000, 1000));
  ASSERT r = 'A verified limit cannot be lower than the email-only limit', 'upside down: ' || r;
  r := pg_temp.as_user(boss, format(setq, 1000, 1000, 200000000, 100000000, 100000000, 500000000, 1000, 5000));
  ASSERT r = 'The smallest share per person cannot be more than the smallest giveaway', 'each above total: ' || r;
  r := pg_temp.as_user(boss, format(setq, 1000, 1000, 200000000, 10000, 100000000, 500000000, 10000, 1000));
  ASSERT r = 'The largest spray must be at least 200 bundles (one note)', 'spray max below one note: ' || r;
  r := pg_temp.as_user(boss, format(setq, 1000, 1000, 0, 100000000, 100000000, 500000000, 10000, 1000));
  ASSERT r = 'The daily sale limit must be more than 0', 'zero sale limit: ' || r;
  r := pg_temp.as_user(boss, format(setq, 1000, 1000, 200000000, 100000000, 5000, 500000000, 10000, 1000));
  ASSERT r = 'A daily spray limit must be 0 (sprays off) or at least 200 bundles', 'spray limit below one note: ' || r;
  r := pg_temp.as_user(boss, format(setq, 1000, 'NULL', 200000000, 100000000, 100000000, 500000000, 10000, 1000));
  ASSERT r = 'Every limit is required', 'missing: ' || r;

  r := pg_temp.as_user(boss, format(setq, 500, 2000, 100000000, 50000000, 30000000, 400000000, 20000, 2000));
  ASSERT r IN ('OK', ''), 'a super admin sets them: ' || r;
  ASSERT (SELECT bundle_min_purchase = 500 AND bundle_sell_min = 2000 AND withdrawal_daily_limit_l2_kobo = 100000000
            AND spray_max_single_ngn_kobo = 50000000 AND spray_daily_limit_l1_kobo = 30000000 AND spray_daily_limit_l2_kobo = 400000000
            AND giveaway_min_total_kobo = 20000 AND giveaway_min_per_person_kobo = 2000
          FROM public.platform_settings WHERE id = 1), 'saved';
  ASSERT (SELECT count(*) FROM public.admin_audit_log WHERE action = 'set_platform_limits' AND admin_user_id = boss_auth
            AND (details->>'bundle_min_purchase')::bigint = 500 AND details->'before'->>'bundle_min_purchase' IS NOT NULL) = 1, 'recorded with old and new values';

  r := pg_temp.as_user(fin, 'SELECT public.get_platform_limits()->>$k$sell_daily_limit_kobo$k$');
  ASSERT r = '100000000', 'any admin reads them: ' || r;

  -- the app reads what it needs to check a form, in bundles, and nothing about daily allowances
  j := pg_temp.as_user(someone, 'SELECT public.app_limits()::text')::jsonb;
  ASSERT j = '{"min_purchase": 500, "min_sell": 2000, "max_spray": 500000, "min_giveaway_total": 200, "min_giveaway_per_person": 20}'::jsonb, 'app limits: ' || j::text;
END $$;

SELECT 'ALL 115 TESTS PASSED' AS result;
