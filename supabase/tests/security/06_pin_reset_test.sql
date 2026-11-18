-- 109: a PIN can be reset only from a session opened with an emailed code in the last 10 minutes.
-- Run as: BEGIN; migration 109; tests/ads/_setup.sql; this file; ROLLBACK.

CREATE FUNCTION pg_temp.text_as(p_role text, q text) RETURNS text LANGUAGE plpgsql AS $$
DECLARE v text;
BEGIN
  EXECUTE format('SET LOCAL ROLE %I', p_role);
  BEGIN EXECUTE q INTO v; EXCEPTION WHEN OTHERS THEN RESET ROLE; RETURN SQLSTATE || ' ' || SQLERRM; END;
  RESET ROLE; RETURN v;
END $$;

-- A session for p_user opened by p_method, p_age ago; the request is then signed with it.
CREATE FUNCTION pg_temp.session_as(p_user uuid, p_method text, p_age interval) RETURNS uuid LANGUAGE plpgsql AS $$
DECLARE v_auth uuid := (SELECT auth_id FROM public.users WHERE id = p_user); v_session uuid := gen_random_uuid();
BEGIN
  INSERT INTO auth.sessions (id, user_id, created_at, updated_at) VALUES (v_session, v_auth, now() - p_age, now() - p_age);
  INSERT INTO auth.mfa_amr_claims (id, session_id, created_at, updated_at, authentication_method)
  VALUES (gen_random_uuid(), v_session, now() - p_age, now() - p_age, p_method);
  PERFORM set_config('request.jwt.claims',
    json_build_object('sub', v_auth, 'role', 'authenticated', 'session_id', v_session)::text, true);
  RETURN v_session;
END $$;

CREATE TEMP TABLE t (k text PRIMARY KEY, v uuid);
GRANT ALL ON t TO anon, authenticated, service_role;
DO $$
BEGIN
  INSERT INTO t VALUES
    ('forgot', pg_temp.mk_user('s109-forgot@test.local', 0)),
    ('other', pg_temp.mk_user('s109-other@test.local', 0)),
    ('nopin', pg_temp.mk_user('s109-nopin@test.local', 0));
  UPDATE public.users
  SET transaction_pin_hash = extensions.crypt('1234', extensions.gen_salt('bf')), transaction_pin_set_at = now() - interval '30 days',
      transaction_pin_failed_attempts = 5, transaction_pin_lockouts = 4, transaction_pin_locked_until = now() + interval '20 hours'
  WHERE id IN (SELECT v FROM t WHERE k IN ('forgot', 'other'));
END $$;

DO $$
BEGIN
  ASSERT NOT has_function_privilege('anon', 'public.reset_transaction_pin(text)', 'EXECUTE'), 'signed out cannot reset a PIN';
  ASSERT has_function_privilege('authenticated', 'public.reset_transaction_pin(text)', 'EXECUTE'), 'the app resets the PIN';
END $$;

DO $$
DECLARE
  u uuid := (SELECT v FROM t WHERE k = 'forgot'); o uuid := (SELECT v FROM t WHERE k = 'other');
  q text := 'SELECT public.reset_transaction_pin(%L)'; chk text := 'SELECT public.check_transaction_pin(%L, %L)';
  other_session uuid;
BEGIN
  -- a signed-in session is not enough, however it was opened
  PERFORM pg_temp.auth_as(u);
  ASSERT pg_temp.text_as('authenticated', format(q, '4321')) = 'CODE_REQUIRED', 'no session on record';
  PERFORM pg_temp.session_as(u, 'password', interval '1 minute');
  ASSERT pg_temp.text_as('authenticated', format(q, '4321')) = 'CODE_REQUIRED', 'a password sign-in does not prove the inbox';
  PERFORM pg_temp.session_as(u, 'oauth', interval '1 minute');
  ASSERT pg_temp.text_as('authenticated', format(q, '4321')) = 'CODE_REQUIRED', 'nor does a Google sign-in';
  PERFORM pg_temp.session_as(u, 'otp', interval '11 minutes');
  ASSERT pg_temp.text_as('authenticated', format(q, '4321')) = 'CODE_REQUIRED', 'an old code session has expired for this';

  -- someone else''s fresh code session does not count
  other_session := pg_temp.session_as(o, 'otp', interval '1 minute');
  PERFORM set_config('request.jwt.claims', json_build_object('sub', (SELECT auth_id FROM public.users WHERE id = u),
    'role', 'authenticated', 'session_id', other_session)::text, true);
  ASSERT pg_temp.text_as('authenticated', format(q, '4321')) = 'CODE_REQUIRED', 'the session must be the caller''s own';
  PERFORM set_config('request.jwt.claims', json_build_object('sub', (SELECT auth_id FROM public.users WHERE id = u),
    'role', 'authenticated', 'session_id', 'not-a-uuid')::text, true);
  ASSERT pg_temp.text_as('authenticated', format(q, '4321')) = 'CODE_REQUIRED', 'a malformed session id is refused, not an error';

  ASSERT (SELECT extensions.crypt('1234', transaction_pin_hash) = transaction_pin_hash AND transaction_pin_lockouts = 4
          FROM public.users WHERE id = u), 'nothing changed so far';

  -- a fresh emailed code does it
  PERFORM pg_temp.session_as(u, 'otp', interval '2 minutes');
  ASSERT pg_temp.text_as('authenticated', format(q, '12')) = 'PIN_FORMAT', 'the new PIN must be 4 digits';
  ASSERT pg_temp.text_as('authenticated', format(q, '4321')) = 'OK', 'reset with a fresh code';
  ASSERT (SELECT transaction_pin_failed_attempts = 0 AND transaction_pin_lockouts = 0 AND transaction_pin_locked_until IS NULL
            AND transaction_pin_set_at > now() - interval '1 minute' FROM public.users WHERE id = u), 'the lock is cleared';
  ASSERT pg_temp.text_as('service_role', format(chk, u, '4321')) = 'OK', 'the new PIN pays';
  ASSERT pg_temp.text_as('service_role', format(chk, u, '1234')) = 'INVALID_PIN', 'the old one does not';
  ASSERT (SELECT count(*) FROM public.notifications WHERE user_id = u AND title = 'Transaction PIN reset') = 1, 'the owner is told';
  ASSERT (SELECT extensions.crypt('1234', transaction_pin_hash) = transaction_pin_hash AND transaction_pin_lockouts = 4
          FROM public.users WHERE id = o), 'nobody else is touched';

  -- three a day
  ASSERT pg_temp.text_as('authenticated', format(q, '1111')) = 'OK', 'second reset';
  ASSERT pg_temp.text_as('authenticated', format(q, '2222')) = 'OK', 'third reset';
  ASSERT pg_temp.text_as('authenticated', format(q, '3333')) = 'TOO_MANY', 'the fourth waits for tomorrow';
  ASSERT pg_temp.text_as('service_role', format(chk, u, '2222')) = 'OK', 'the third reset stands';
END $$;

-- someone who never set a PIN can set one this way too
DO $$
DECLARE n uuid := (SELECT v FROM t WHERE k = 'nopin');
BEGIN
  PERFORM pg_temp.session_as(n, 'otp', interval '1 minute');
  ASSERT pg_temp.text_as('authenticated', 'SELECT public.reset_transaction_pin(''5555'')') = 'OK', 'works without an earlier PIN';
  ASSERT pg_temp.text_as('service_role', format('SELECT public.check_transaction_pin(%L, ''5555'')', n)) = 'OK', 'and the PIN pays';
END $$;

SELECT 'ALL 109 TESTS PASSED' AS result;
