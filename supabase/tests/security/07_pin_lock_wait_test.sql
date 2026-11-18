-- 110: a person can read how long their own PIN lock lasts, and nothing else.
-- Run as: BEGIN; migration 110; tests/ads/_setup.sql; this file; ROLLBACK.

CREATE FUNCTION pg_temp.text_as(p_role text, q text) RETURNS text LANGUAGE plpgsql AS $$
DECLARE v text;
BEGIN
  EXECUTE format('SET LOCAL ROLE %I', p_role);
  BEGIN EXECUTE q INTO v; EXCEPTION WHEN OTHERS THEN RESET ROLE; RETURN SQLSTATE || ' ' || SQLERRM; END;
  RESET ROLE; RETURN v;
END $$;

DO $$
DECLARE
  locked uuid := pg_temp.mk_user('s110-locked@test.local', 0);
  free uuid := pg_temp.mk_user('s110-free@test.local', 0);
  q text := 'SELECT public.transaction_pin_lock_seconds()'; n int;
BEGIN
  ASSERT NOT has_function_privilege('anon', 'public.transaction_pin_lock_seconds()', 'EXECUTE'), 'signed out cannot ask';
  ASSERT has_function_privilege('authenticated', 'public.transaction_pin_lock_seconds()', 'EXECUTE'), 'the app asks';

  UPDATE public.users SET transaction_pin_locked_until = now() + interval '6 hours' WHERE id = locked;
  PERFORM pg_temp.auth_as(locked);
  n := pg_temp.text_as('authenticated', q)::int;
  ASSERT n BETWEEN 6 * 3600 - 5 AND 6 * 3600, 'six hours left: ' || n;

  PERFORM pg_temp.auth_as(free);
  ASSERT pg_temp.text_as('authenticated', q) = '0', 'someone else''s lock is not theirs';

  UPDATE public.users SET transaction_pin_locked_until = now() - interval '1 minute' WHERE id = locked;
  PERFORM pg_temp.auth_as(locked);
  ASSERT pg_temp.text_as('authenticated', q) = '0', 'a lock that is over is 0';

  PERFORM set_config('request.jwt.claims', '', true);
  ASSERT pg_temp.text_as('service_role', q) = '0', 'no caller, no lock';
END $$;

SELECT 'ALL 110 TESTS PASSED' AS result;
