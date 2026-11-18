-- 111: with the rule on, a super admin session without the two-step code is not a super admin.
-- Run as: BEGIN; migration 111; tests/ads/_setup.sql; this file; ROLLBACK.

CREATE FUNCTION pg_temp.text_as(p_role text, q text) RETURNS text LANGUAGE plpgsql AS $$
DECLARE v text;
BEGIN
  EXECUTE format('SET LOCAL ROLE %I', p_role);
  BEGIN EXECUTE q INTO v; EXCEPTION WHEN OTHERS THEN RESET ROLE; RETURN SQLSTATE || ' ' || SQLERRM; END;
  RESET ROLE; RETURN v;
END $$;

-- Sign the request as p_user with the given assurance level (NULL = an older token without the claim).
CREATE FUNCTION pg_temp.auth_aal(p_user uuid, p_aal text) RETURNS void LANGUAGE sql AS $$
  SELECT set_config('request.jwt.claims',
    (jsonb_build_object('sub', (SELECT auth_id FROM public.users WHERE id = p_user), 'role', 'authenticated')
      || CASE WHEN p_aal IS NULL THEN '{}'::jsonb ELSE jsonb_build_object('aal', p_aal) END)::text, true)
$$;

DO $$
DECLARE
  boss uuid := pg_temp.mk_admin('s111-boss@test.local', 'super_admin');
  boss2 uuid := pg_temp.mk_admin('s111-boss2@test.local', 'super_admin');
  fin uuid := pg_temp.mk_admin('s111-fin@test.local', 'finance');
  boss_auth uuid := (SELECT auth_id FROM public.users WHERE id = boss);
  boss2_auth uuid := (SELECT auth_id FROM public.users WHERE id = boss2);
  fin_auth uuid := (SELECT auth_id FROM public.users WHERE id = fin);
  q text := 'SELECT public.has_admin_role(%L, %L)';
  topup text := 'SELECT public.record_treasury_topup(''NGN'', 100, NULL, ''s111'')';
BEGIN
  ASSERT (SELECT admin_two_step_required FROM public.platform_settings WHERE id = 1) = false, 'the rule ships off';

  -- rule off: as before, whatever the session
  PERFORM pg_temp.auth_aal(boss, 'aal1');
  ASSERT pg_temp.text_as('authenticated', format(q, boss_auth, 'super_admin')) = 'true', 'off: password only is a super admin';
  ASSERT pg_temp.text_as('authenticated', topup) ~ '^[0-9a-f-]{36}$', 'off: a super admin tops up';

  UPDATE public.platform_settings SET admin_two_step_required = true WHERE id = 1;

  -- rule on: the code is needed
  ASSERT pg_temp.text_as('authenticated', format(q, boss_auth, 'super_admin')) = 'false', 'on: password only is not a super admin';
  ASSERT pg_temp.text_as('authenticated', 'SELECT public.record_treasury_topup(''NGN'', 101, NULL, ''s111'')') LIKE '%Only finance or super admins%', 'on: and cannot top up';
  PERFORM pg_temp.auth_aal(boss, NULL);
  ASSERT pg_temp.text_as('authenticated', format(q, boss_auth, 'super_admin')) = 'false', 'on: a token without the claim is password only';
  PERFORM pg_temp.auth_aal(boss, 'aal2');
  ASSERT pg_temp.text_as('authenticated', format(q, boss_auth, 'super_admin')) = 'true', 'on: with the code, a super admin';
  ASSERT pg_temp.text_as('authenticated', 'SELECT public.record_treasury_topup(''NGN'', 102, NULL, ''s111'')') ~ '^[0-9a-f-]{36}$', 'on: and tops up';

  -- other roles are not held to it
  PERFORM pg_temp.auth_aal(fin, 'aal1');
  ASSERT pg_temp.text_as('authenticated', format(q, fin_auth, 'finance')) = 'true', 'on: finance signs in as before';
  ASSERT pg_temp.text_as('authenticated', 'SELECT public.record_treasury_topup(''NGN'', 103, NULL, ''s111'')') ~ '^[0-9a-f-]{36}$', 'on: finance tops up';
  ASSERT pg_temp.text_as('authenticated', format(q, fin_auth, 'super_admin')) = 'false', 'finance is not a super admin';

  -- asking about someone else is a fact about them, not about this session
  ASSERT pg_temp.text_as('authenticated', format(q, boss2_auth, 'super_admin')) = 'true', 'another person''s role is reported as it is';

  -- server-side callers (the functions) have no session: they apply the rule themselves
  PERFORM set_config('request.jwt.claims', '', true);
  ASSERT pg_temp.text_as('service_role', format(q, boss_auth, 'super_admin')) = 'true', 'no session: the stored role';
  ASSERT public.has_admin_role(boss_auth, 'super_admin'), 'owner context: the stored role';

  -- a disabled super admin is not one, code or not
  UPDATE public.admin_roles SET status = 'disabled' WHERE user_id = boss_auth;
  PERFORM pg_temp.auth_aal(boss, 'aal2');
  ASSERT pg_temp.text_as('authenticated', format(q, boss_auth, 'super_admin')) = 'false', 'disabled stays disabled';
END $$;

SELECT 'ALL 111 TESTS PASSED' AS result;
