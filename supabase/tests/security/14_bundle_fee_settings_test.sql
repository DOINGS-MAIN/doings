-- 117: a super admin reads and sets the buy and sell fees people actually pay.
-- Run as: BEGIN; migration 117; tests/ads/_setup.sql; this file; ROLLBACK.

CREATE FUNCTION pg_temp.as_user(p_user uuid, q text) RETURNS text LANGUAGE plpgsql AS $$
DECLARE v text;
BEGIN
  PERFORM pg_temp.auth_as(p_user);
  SET LOCAL ROLE authenticated;
  BEGIN EXECUTE q INTO v; EXCEPTION WHEN OTHERS THEN RESET ROLE; RETURN SQLERRM; END;
  RESET ROLE; RETURN COALESCE(NULLIF(v, ''), 'OK');
END $$;

DO $$
DECLARE
  boss uuid := pg_temp.mk_admin('s117-boss@test.local', 'super_admin');
  fin uuid := pg_temp.mk_admin('s117-fin@test.local', 'finance');
  nobody uuid := pg_temp.mk_user('s117-nobody@test.local', 0);
  setq text := 'SELECT public.set_bundle_fee_settings(%s, %s, %s, %s)::text';
  r text; s jsonb; before_fees jsonb;
BEGIN
  SELECT jsonb_build_object('bp', bundle_fee_percent, 'bf', bundle_fee_flat_kobo, 'sp', bundle_sell_fee_percent, 'sf', bundle_sell_fee_flat_kobo)
    INTO before_fees FROM public.platform_settings WHERE id = 1;
  UPDATE public.platform_settings SET bundle_sell_min = 1000 WHERE id = 1;

  ASSERT NOT has_function_privilege('anon', 'public.set_bundle_fee_settings(numeric, bigint, numeric, bigint)', 'EXECUTE'), 'signed out cannot set';
  ASSERT NOT has_function_privilege('anon', 'public.get_bundle_fee_settings()', 'EXECUTE'), 'signed out cannot read';
  ASSERT NOT has_function_privilege('authenticated', 'public.bundle_fee_settings_json()', 'EXECUTE'), 'the helper is not callable from the app';

  r := pg_temp.as_user(nobody, format(setq, 0, 15000, 0, 15000));
  ASSERT r = 'Only super admins can change fees', 'an ordinary person: ' || r;
  r := pg_temp.as_user(fin, format(setq, 0, 15000, 0, 15000));
  ASSERT r = 'Only super admins can change fees', 'a finance admin: ' || r;
  r := pg_temp.as_user(nobody, 'SELECT public.get_bundle_fee_settings()::text');
  ASSERT r = 'Only super admins can see the fee settings', 'an ordinary person cannot read: ' || r;

  -- applying the migration changes nothing by itself
  s := pg_temp.as_user(boss, 'SELECT public.get_bundle_fee_settings()::text')::jsonb;
  ASSERT (s->>'sell_fee_flat_kobo')::bigint = (before_fees->>'sf')::bigint AND (s->>'buy_fee_flat_kobo')::bigint = (before_fees->>'bf')::bigint,
    'the admin sees the fees in force: ' || s::text;

  r := pg_temp.as_user(boss, format(setq, -1, 0, 0, 0));
  ASSERT r = 'A fee cannot be negative', 'negative: ' || r;
  r := pg_temp.as_user(boss, format(setq, 0, 0, 50, 0));
  ASSERT r = 'A percentage fee must be below 50', 'too high: ' || r;
  r := pg_temp.as_user(boss, format(setq, 'NULL', 0, 0, 0));
  ASSERT r = 'Every fee is required', 'missing: ' || r;
  -- smallest sale is 1,000 bundles (100,000 kobo): a flat N1,000 fee would take all of it
  r := pg_temp.as_user(boss, format(setq, 0, 0, 0, 100000));
  ASSERT r LIKE 'The sell fee would take all of the smallest sale%', 'fee swallows the smallest sale: ' || r;
  ASSERT (SELECT bundle_sell_fee_flat_kobo FROM public.platform_settings WHERE id = 1) = (before_fees->>'sf')::bigint, 'a refused save changes nothing';

  -- 5% + N50 on selling, 1.5% + N100 on buying
  r := pg_temp.as_user(boss, format(setq, 1.5, 10000, 5, 5000));
  ASSERT r = 'OK', 'a super admin saves: ' || r;
  ASSERT (SELECT bundle_fee_percent = 1.5 AND bundle_fee_flat_kobo = 10000 AND bundle_sell_fee_percent = 5 AND bundle_sell_fee_flat_kobo = 5000
          FROM public.platform_settings WHERE id = 1), 'the fees people pay are the ones saved';
  ASSERT (SELECT count(*) FROM public.admin_audit_log
          WHERE action = 'set_bundle_fee_settings' AND (details->>'sell_fee_flat_kobo')::bigint = 5000
            AND (details->'before'->>'sell_fee_flat_kobo')::bigint = (before_fees->>'sf')::bigint) = 1, 'recorded with the old and new values';
END $$;
SELECT 'PASS 14_bundle_fee_settings' AS result;
