-- 114: what a person must have done to sell bundles follows two admin switches (BVN, selfie).
-- Run as: BEGIN; migration 113; migration 114; tests/ads/_setup.sql; this file; ROLLBACK.

CREATE FUNCTION pg_temp.as_user(p_user uuid, q text) RETURNS text LANGUAGE plpgsql AS $$
DECLARE v text;
BEGIN
  PERFORM pg_temp.auth_as(p_user);
  SET LOCAL ROLE authenticated;
  BEGIN EXECUTE q INTO v; EXCEPTION WHEN OTHERS THEN RESET ROLE; RETURN SQLERRM; END;
  RESET ROLE; RETURN COALESCE(v, 'OK');
END $$;

CREATE FUNCTION pg_temp.switches(p_bvn boolean, p_selfie boolean) RETURNS void LANGUAGE sql AS $$
  UPDATE public.platform_settings SET sell_requires_bvn = p_bvn, sell_requires_selfie = p_selfie WHERE id = 1
$$;

CREATE FUNCTION pg_temp.ok(p_user uuid) RETURNS boolean LANGUAGE sql AS $$
  SELECT (public.sell_identity_status(p_user)->>'ok')::boolean
$$;

CREATE FUNCTION pg_temp.sell(p_user uuid) RETURNS text LANGUAGE plpgsql AS $$
BEGIN
  PERFORM public.create_bundle_sale(p_user, 5000, 'NGN', '{"account_number":"0123456789","bank_code":"058","account_name":"X"}'::jsonb,
    's114-' || gen_random_uuid()::text);
  RETURN 'OK';
EXCEPTION WHEN OTHERS THEN RETURN SQLERRM;
END $$;

DO $$
DECLARE
  email_only uuid := pg_temp.mk_user('s114-email@test.local', 100000000);
  full_kyc uuid := pg_temp.mk_user('s114-both@test.local', 100000000);
  bvn_only uuid := pg_temp.mk_user('s114-bvn@test.local', 100000000);
  selfie_only uuid := pg_temp.mk_user('s114-selfie@test.local', 100000000);
  legacy uuid := pg_temp.mk_user('s114-legacy@test.local', 100000000);
  unverified uuid := pg_temp.mk_user('s114-none@test.local', 100000000);
  st jsonb; r text;
BEGIN
  ASSERT (SELECT sell_requires_bvn AND sell_requires_selfie FROM public.platform_settings WHERE id = 1), 'ships with both checks on';

  -- the three kinds of record the verify function writes, and a level-2 person from before 114
  INSERT INTO public.kyc_verifications (user_id, level, status, provider, verification_method, bvn_hmac, bvn_last_four, bvn_first_name, bvn_last_name, liveness_score, selfie_match_confidence, verified_at)
    VALUES (full_kyc, 2, 'verified', 'dojah', 'bvn_selfie', 's114-h1', '1111', 'Ada', 'Obi', 97, 95, now());
  INSERT INTO public.kyc_verifications (user_id, level, status, provider, verification_method, bvn_hmac, bvn_last_four, bvn_first_name, bvn_last_name, verified_at)
    VALUES (bvn_only, 2, 'verified', 'dojah', 'bvn', 's114-h2', '2222', 'Bola', 'Ade', now());
  INSERT INTO public.kyc_verifications (user_id, level, status, provider, verification_method, liveness_score, verified_at)
    VALUES (selfie_only, 1, 'verified', 'dojah', 'selfie', 96, now());
  UPDATE public.users SET kyc_level = 2 WHERE id = legacy;
  UPDATE public.users SET kyc_level = 0 WHERE id = unverified;

  ASSERT (SELECT kyc_level FROM public.users WHERE id = bvn_only) = 2, 'a BVN record is level 2';
  ASSERT (SELECT kyc_level FROM public.users WHERE id = selfie_only) = 1, 'a selfie alone is not level 2: it does not say who the person is';

  -- both on (today's rule)
  ASSERT pg_temp.ok(full_kyc), 'both on: BVN + selfie sells';
  ASSERT pg_temp.ok(legacy), 'both on: someone verified before 114 still sells';
  ASSERT NOT pg_temp.ok(bvn_only), 'both on: BVN alone is not enough';
  ASSERT NOT pg_temp.ok(selfie_only), 'both on: selfie alone is not enough';
  ASSERT NOT pg_temp.ok(email_only), 'both on: email alone is not enough';
  st := public.sell_identity_status(bvn_only);
  ASSERT (st->>'needs_bvn')::boolean AND (st->>'needs_selfie')::boolean AND (st->>'has_bvn')::boolean AND NOT (st->>'has_selfie')::boolean, 'status says what is missing: ' || st::text;
  r := pg_temp.sell(email_only);
  ASSERT r = 'Complete identity verification to sell bundles', 'both on: the sale itself refuses: ' || r;
  ASSERT pg_temp.sell(full_kyc) = 'OK', 'both on: a verified person sells';

  -- selfie off
  PERFORM pg_temp.switches(true, false);
  ASSERT pg_temp.ok(bvn_only) AND pg_temp.ok(full_kyc) AND pg_temp.ok(legacy), 'selfie off: BVN is enough';
  ASSERT NOT pg_temp.ok(selfie_only) AND NOT pg_temp.ok(email_only), 'selfie off: BVN still needed';
  ASSERT pg_temp.sell(bvn_only) = 'OK', 'selfie off: BVN-only person sells';

  -- BVN off
  PERFORM pg_temp.switches(false, true);
  ASSERT pg_temp.ok(selfie_only) AND pg_temp.ok(full_kyc) AND pg_temp.ok(legacy), 'BVN off: a selfie is enough';
  ASSERT NOT pg_temp.ok(bvn_only) AND NOT pg_temp.ok(email_only), 'BVN off: the selfie is still needed';
  ASSERT pg_temp.sell(selfie_only) = 'OK', 'BVN off: selfie-only person sells';

  -- both off
  PERFORM pg_temp.switches(false, false);
  ASSERT pg_temp.ok(email_only) AND pg_temp.ok(selfie_only) AND pg_temp.ok(bvn_only), 'both off: a verified email sells';
  ASSERT pg_temp.sell(email_only) = 'OK', 'both off: email-only person sells';
  ASSERT NOT pg_temp.ok(unverified), 'both off: an unverified email still cannot';
  r := pg_temp.sell(unverified);
  ASSERT r = 'Verify your email to sell bundles', 'both off: unverified email refused: ' || r;

  -- A BVN and a selfie done separately were never matched to each other: with both required, that
  -- is not enough (the selfie could be one person and the BVN another).
  PERFORM pg_temp.switches(true, true);
  INSERT INTO public.kyc_verifications (user_id, level, status, provider, verification_method, liveness_score, verified_at)
    VALUES (bvn_only, 1, 'verified', 'dojah', 'selfie', 95, now());
  ASSERT NOT pg_temp.ok(bvn_only), 'both on: a separate BVN and selfie do not add up to a matched pair';
  st := public.sell_identity_status(bvn_only);
  ASSERT (st->>'has_bvn')::boolean AND NOT (st->>'has_selfie')::boolean, 'so the selfie is asked for again, with the BVN: ' || st::text;
  PERFORM pg_temp.switches(false, true);
  ASSERT pg_temp.ok(bvn_only), 'selfie only: that same selfie does count on its own';
  PERFORM pg_temp.switches(true, false);
  ASSERT pg_temp.ok(bvn_only), 'BVN only: and the BVN on its own';

  -- a superseded or unverified record does not count
  PERFORM pg_temp.switches(true, true);
  UPDATE public.kyc_verifications SET superseded_at = now() WHERE user_id = selfie_only;
  PERFORM pg_temp.switches(false, true);
  ASSERT NOT pg_temp.ok(selfie_only), 'a superseded selfie record does not count';
  ASSERT NOT pg_temp.ok(gen_random_uuid()), 'an unknown person cannot sell';
END $$;

-- who may read and set
DO $$
DECLARE
  boss uuid := pg_temp.mk_admin('s114-boss@test.local', 'super_admin');
  fin uuid := pg_temp.mk_admin('s114-fin@test.local', 'finance');
  someone uuid := pg_temp.mk_user('s114-someone@test.local', 0);
  other uuid := pg_temp.mk_user('s114-other@test.local', 0);
  boss_auth uuid := (SELECT auth_id FROM public.users WHERE id = boss);
  r text;
BEGIN
  PERFORM pg_temp.switches(true, true);
  ASSERT NOT has_function_privilege('anon', 'public.set_sell_identity_settings(boolean, boolean)', 'EXECUTE'), 'signed out cannot set';
  ASSERT NOT has_function_privilege('authenticated', 'public.sell_identity_status(uuid)', 'EXECUTE'), 'the app cannot ask about another person';
  ASSERT NOT has_function_privilege('anon', 'public.my_sell_identity_status()', 'EXECUTE'), 'signed out cannot ask';

  r := pg_temp.as_user(someone, 'SELECT public.set_sell_identity_settings(false, false)::text');
  ASSERT r = 'Only super admins can change selling checks', 'an ordinary person: ' || r;
  r := pg_temp.as_user(fin, 'SELECT public.set_sell_identity_settings(false, false)::text');
  ASSERT r = 'Only super admins can change selling checks', 'a finance admin: ' || r;
  r := pg_temp.as_user(boss, 'SELECT public.set_sell_identity_settings(NULL, false)::text');
  ASSERT r = 'Both switches are required', 'missing: ' || r;

  r := pg_temp.as_user(boss, 'SELECT public.set_sell_identity_settings(true, false)::text');
  ASSERT r IN ('OK', ''), 'a super admin sets them: ' || r;
  ASSERT (SELECT sell_requires_bvn AND NOT sell_requires_selfie FROM public.platform_settings WHERE id = 1), 'saved';
  ASSERT (SELECT count(*) FROM public.admin_audit_log WHERE action = 'set_sell_identity_settings' AND admin_user_id = boss_auth
            AND details->>'sell_requires_selfie' = 'false' AND details->'before'->>'sell_requires_selfie' = 'true') = 1, 'recorded with old and new values';

  -- a person reads their own status, and only their own
  r := pg_temp.as_user(someone, 'SELECT public.my_sell_identity_status()::text');
  ASSERT r::jsonb = '{"ok": false, "has_bvn": false, "has_selfie": false, "needs_bvn": true, "needs_selfie": false}'::jsonb, 'own status: ' || r;
  r := pg_temp.as_user(fin, 'SELECT public.get_gifting_settings()->>$k$sell_requires_bvn$k$');
  ASSERT r = 'true', 'admins read the switches with the other settings: ' || r;
END $$;

SELECT 'ALL 114 TESTS PASSED' AS result;
