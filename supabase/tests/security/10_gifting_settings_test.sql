-- 113: giveaways count against a daily limit; sharing needs BVN only when the admin switch says so.
-- Run as: BEGIN; migration 113; tests/ads/_setup.sql; this file; ROLLBACK.

CREATE FUNCTION pg_temp.give(p_user uuid, p_total bigint) RETURNS text LANGUAGE plpgsql AS $$
BEGIN
  PERFORM public.create_giveaway_funded(p_user, 's113', p_total, p_total, 'scheduled'::public.giveaway_type);
  RETURN 'OK';
EXCEPTION WHEN OTHERS THEN RETURN SQLERRM;
END $$;

DO $$
DECLARE
  l1 uuid := pg_temp.mk_user('s113-l1@test.local', 100000000);
  l2 uuid := pg_temp.mk_user('s113-l2@test.local', 100000000);
  l0 uuid := pg_temp.mk_user('s113-l0@test.local', 100000000);
  bal bigint; r text;
BEGIN
  ASSERT (SELECT giveaway_daily_limit_l1_kobo FROM public.platform_settings WHERE id = 1) = 20000000, 'level 1 ships at N200,000 a day';
  ASSERT (SELECT giveaway_daily_limit_l2_kobo FROM public.platform_settings WHERE id = 1) = 500000000, 'level 2 ships at N5,000,000 a day';

  UPDATE public.users SET kyc_level = 2 WHERE id = l2;
  UPDATE public.users SET kyc_level = 0 WHERE id = l0;
  UPDATE public.platform_settings SET giveaway_daily_limit_l1_kobo = 50000, giveaway_daily_limit_l2_kobo = 200000 WHERE id = 1;

  -- level 1: N500 a day
  ASSERT pg_temp.give(l1, 30000) = 'OK', 'first giveaway inside the limit';
  SELECT balance INTO bal FROM public.wallets WHERE user_id = l1 AND currency = 'NGN';
  r := pg_temp.give(l1, 30000);
  ASSERT r = 'GIVEAWAY_DAILY_LIMIT 20000', 'over the limit is refused and says what is left: ' || r;
  ASSERT (SELECT balance FROM public.wallets WHERE user_id = l1 AND currency = 'NGN') = bal, 'a refused giveaway takes no money';
  ASSERT (SELECT count(*) FROM public.giveaways WHERE creator_id = l1) = 1, 'and creates nothing';
  ASSERT pg_temp.give(l1, 20000) = 'OK', 'exactly up to the limit is allowed';
  r := pg_temp.give(l1, 10000);
  ASSERT r = 'GIVEAWAY_DAILY_LIMIT 0', 'nothing left: ' || r;

  -- a stopped giveaway still counts: stop-and-recreate is not a way round the limit
  UPDATE public.giveaways SET status = 'stopped' WHERE creator_id = l1;
  r := pg_temp.give(l1, 10000);
  ASSERT r = 'GIVEAWAY_DAILY_LIMIT 0', 'stopped giveaways count: ' || r;

  -- yesterday does not count
  UPDATE public.giveaways SET created_at = now() - interval '25 hours' WHERE creator_id = l1;
  ASSERT pg_temp.give(l1, 50000) = 'OK', 'a new day, a new allowance';

  -- level 2 has its own limit; one person's giveaways do not use another's allowance
  ASSERT pg_temp.give(l2, 200000) = 'OK', 'level 2 up to its limit';
  r := pg_temp.give(l2, 10000);
  ASSERT r = 'GIVEAWAY_DAILY_LIMIT 0', 'level 2 over its limit: ' || r;

  -- an unverified account has no allowance
  r := pg_temp.give(l0, 10000);
  ASSERT r = 'GIVEAWAY_DAILY_LIMIT 0', 'level 0: ' || r;

  -- the old rules still answer first
  -- worded in naira by 113, in bundles once 115 makes the minimum a setting
  ASSERT pg_temp.give(l1, 5000) LIKE 'Minimum total is %', 'minimum still enforced';
END $$;

-- Gifting settings are set from the admin, by super admins only, and each change is recorded.
CREATE FUNCTION pg_temp.as_user(p_user uuid, q text) RETURNS text LANGUAGE plpgsql AS $$
DECLARE v text;
BEGIN
  PERFORM pg_temp.auth_as(p_user);
  SET LOCAL ROLE authenticated;
  BEGIN EXECUTE q INTO v; EXCEPTION WHEN OTHERS THEN RESET ROLE; RETURN SQLERRM; END;
  RESET ROLE; RETURN COALESCE(v, 'OK');
END $$;

DO $$
DECLARE
  boss uuid := pg_temp.mk_admin('s113-boss@test.local', 'super_admin');
  fin uuid := pg_temp.mk_admin('s113-fin@test.local', 'finance');
  nobody uuid := pg_temp.mk_user('s113-nobody@test.local', 0);
  boss_auth uuid := (SELECT auth_id FROM public.users WHERE id = boss);
  -- share needs identity, share l1, share l2, giveaway l1, giveaway l2
  setq text := 'SELECT public.set_gifting_settings(%s, %s, %s, %s, %s)::text'; r text;
BEGIN
  -- what ships: sharing needs only a verified email, at N200,000 a day
  ASSERT (SELECT share_requires_identity FROM public.platform_settings WHERE id = 1) = false, 'ships in gifting mode';
  ASSERT (SELECT share_daily_limit_l1_kobo FROM public.platform_settings WHERE id = 1) = 20000000, 'email-only share limit ships at N200,000';
  ASSERT (SELECT share_daily_limit_l2_kobo FROM public.platform_settings WHERE id = 1) = 500000000, 'verified share limit stays N5,000,000';

  ASSERT NOT has_function_privilege('anon', 'public.set_gifting_settings(boolean, bigint, bigint, bigint, bigint)', 'EXECUTE'), 'signed out cannot set';
  ASSERT NOT has_function_privilege('anon', 'public.get_gifting_settings()', 'EXECUTE'), 'signed out cannot read';
  ASSERT NOT has_function_privilege('anon', 'public.share_requires_identity()', 'EXECUTE'), 'signed out cannot ask';

  r := pg_temp.as_user(nobody, format(setq, 'true', 1, 1, 1, 1));
  ASSERT r = 'Only super admins can change gifting settings', 'an ordinary person: ' || r;
  r := pg_temp.as_user(fin, format(setq, 'true', 1, 1, 1, 1));
  ASSERT r = 'Only super admins can change gifting settings', 'a finance admin: ' || r;
  r := pg_temp.as_user(nobody, 'SELECT public.get_gifting_settings()::text');
  ASSERT r = 'Only admins can read gifting settings', 'an ordinary person cannot read the limits: ' || r;
  -- but the app may ask the one thing it needs to draw the right screen
  r := pg_temp.as_user(nobody, 'SELECT public.share_requires_identity()::text');
  ASSERT r = 'false', 'the app learns that sharing needs no BVN: ' || r;

  r := pg_temp.as_user(boss, format(setq, 'true', -1, 100, 100, 100));
  ASSERT r = 'A limit cannot be negative', 'negative: ' || r;
  r := pg_temp.as_user(boss, format(setq, 'true', 5000000, 1000000, 100, 100));
  ASSERT r = 'A verified limit cannot be lower than the email-only limit', 'share upside down: ' || r;
  r := pg_temp.as_user(boss, format(setq, 'true', 100, 100, 5000000, 1000000));
  ASSERT r = 'A verified limit cannot be lower than the email-only limit', 'giveaway upside down: ' || r;
  r := pg_temp.as_user(boss, format(setq, 'NULL', 100, 100, 100, 100));
  ASSERT r = 'Every setting is required', 'missing: ' || r;

  r := pg_temp.as_user(boss, format(setq, 'true', 1000000, 70000000, 3000000, 90000000));
  ASSERT r IN ('OK', ''), 'a super admin sets them: ' || r;
  ASSERT (SELECT share_requires_identity AND share_daily_limit_l1_kobo = 1000000 AND share_daily_limit_l2_kobo = 70000000
            AND giveaway_daily_limit_l1_kobo = 3000000 AND giveaway_daily_limit_l2_kobo = 90000000
          FROM public.platform_settings WHERE id = 1), 'saved';
  ASSERT (SELECT count(*) FROM public.admin_audit_log WHERE action = 'set_gifting_settings' AND admin_user_id = boss_auth
            AND (details->>'share_requires_identity')::boolean AND (details->>'giveaway_l1_kobo')::bigint = 3000000
            AND details->'before'->>'share_requires_identity' = 'false') = 1, 'recorded with the old and new values';
  r := pg_temp.as_user(fin, 'SELECT public.get_gifting_settings()->>$k$share_l1_kobo$k$');
  ASSERT r = '1000000', 'any admin reads them: ' || r;
  r := pg_temp.as_user(nobody, 'SELECT public.share_requires_identity()::text');
  ASSERT r = 'true', 'the app learns the switch is on: ' || r;
END $$;

SELECT 'ALL 113 TESTS PASSED' AS result;
