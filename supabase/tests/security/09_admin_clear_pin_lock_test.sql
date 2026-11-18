-- 112: an admin clears a person's PIN lock; the change, its audit record and the notice are one step.
-- Run as: BEGIN; migration 112; tests/ads/_setup.sql; this file; ROLLBACK.

DO $$
DECLARE
  locked uuid := pg_temp.mk_user('s112-locked@test.local', 0);
  free uuid := pg_temp.mk_user('s112-free@test.local', 0);
  helper uuid := pg_temp.mk_admin('s112-support@test.local', 'support');
  helper_auth uuid := (SELECT auth_id FROM public.users WHERE id = helper);
  r jsonb; msg text;
BEGIN
  ASSERT NOT has_function_privilege('anon', 'public.admin_clear_pin_lock(uuid, uuid, inet)', 'EXECUTE'), 'signed out cannot call it';
  ASSERT NOT has_function_privilege('authenticated', 'public.admin_clear_pin_lock(uuid, uuid, inet)', 'EXECUTE'), 'the app cannot call it';
  ASSERT has_function_privilege('service_role', 'public.admin_clear_pin_lock(uuid, uuid, inet)', 'EXECUTE'), 'the admin function calls it';

  UPDATE public.users
     SET transaction_pin_hash = 'x', transaction_pin_failed_attempts = 5, transaction_pin_lockouts = 3,
         transaction_pin_locked_until = now() + interval '6 hours'
   WHERE id = locked;

  r := public.admin_clear_pin_lock(locked, helper_auth, '102.89.1.7');
  ASSERT (r->>'user_id')::uuid = locked, 'answers with the person';
  ASSERT (SELECT transaction_pin_locked_until IS NULL AND transaction_pin_failed_attempts = 0 FROM public.users WHERE id = locked), 'lock and wrong tries cleared';
  ASSERT (SELECT transaction_pin_lockouts FROM public.users WHERE id = locked) = 3, 'the lock ladder is kept: the next lock is not a fresh 15 minutes';
  ASSERT (SELECT transaction_pin_hash FROM public.users WHERE id = locked) = 'x', 'the PIN itself is untouched';
  ASSERT (SELECT count(*) FROM public.admin_audit_log WHERE action = 'clear_pin_lock' AND target_id = locked AND admin_user_id = helper_auth
            AND (details->>'failed_attempts')::int = 5 AND details->>'locked_until' IS NOT NULL
            AND ip_address = '102.89.1.7') = 1, 'audited with what was cleared and where from';
  ASSERT (SELECT count(*) FROM public.notifications WHERE user_id = locked AND type = 'security') = 1, 'the person is told';

  -- wrong tries short of a lock are NOT cleared: clearing at four tries, again and again, would let
  -- someone guess without ever being locked
  UPDATE public.users SET transaction_pin_failed_attempts = 4 WHERE id = locked;
  BEGIN
    PERFORM public.admin_clear_pin_lock(locked, helper_auth); msg := 'no error';
  EXCEPTION WHEN OTHERS THEN msg := SQLERRM; END;
  ASSERT msg = 'This person''s PIN is not locked', 'four wrong tries, no lock: ' || msg;
  ASSERT (SELECT transaction_pin_failed_attempts FROM public.users WHERE id = locked) = 4, 'wrong tries kept';

  -- a lock that has run out is not a lock
  UPDATE public.users SET transaction_pin_locked_until = now() - interval '1 minute' WHERE id = locked;
  BEGIN
    PERFORM public.admin_clear_pin_lock(locked, helper_auth); msg := 'no error';
  EXCEPTION WHEN OTHERS THEN msg := SQLERRM; END;
  ASSERT msg = 'This person''s PIN is not locked', 'expired lock: ' || msg;

  -- three unlocks a day per person, whoever the admin is
  FOR i IN 2..3 LOOP
    UPDATE public.users SET transaction_pin_locked_until = now() + interval '1 hour' WHERE id = locked;
    PERFORM public.admin_clear_pin_lock(locked, helper_auth);
  END LOOP;
  UPDATE public.users SET transaction_pin_locked_until = now() + interval '1 hour' WHERE id = locked;
  BEGIN
    PERFORM public.admin_clear_pin_lock(locked, helper_auth); msg := 'no error';
  EXCEPTION WHEN OTHERS THEN msg := SQLERRM; END;
  ASSERT msg = 'This PIN has been unlocked 3 times in the last 24 hours. The person can wait for the lock to end or reset the PIN by email.', 'fourth unlock: ' || msg;
  ASSERT (SELECT transaction_pin_locked_until > now() FROM public.users WHERE id = locked), 'still locked after the refusal';
  ASSERT (SELECT count(*) FROM public.admin_audit_log WHERE action = 'clear_pin_lock' AND target_id = locked) = 3, 'three records, not four';
  -- yesterday's unlocks do not count
  UPDATE public.admin_audit_log SET created_at = now() - interval '25 hours' WHERE action = 'clear_pin_lock' AND target_id = locked;
  PERFORM public.admin_clear_pin_lock(locked, helper_auth);

  -- nothing to clear: refused, nothing recorded, nobody notified
  BEGIN
    PERFORM public.admin_clear_pin_lock(free, helper_auth); msg := 'no error';
  EXCEPTION WHEN OTHERS THEN msg := SQLERRM; END;
  ASSERT msg = 'This person''s PIN is not locked', 'nothing to clear: ' || msg;
  ASSERT (SELECT count(*) FROM public.admin_audit_log WHERE action = 'clear_pin_lock' AND target_id = free) = 0, 'nothing recorded';
  ASSERT (SELECT count(*) FROM public.notifications WHERE user_id = free AND type = 'security') = 0, 'nobody notified';

  -- an unknown person is refused
  BEGIN
    PERFORM public.admin_clear_pin_lock(gen_random_uuid(), helper_auth); msg := 'no error';
  EXCEPTION WHEN OTHERS THEN msg := SQLERRM; END;
  ASSERT msg = 'User not found', 'unknown person: ' || msg;
END $$;

SELECT 'ALL 112 TESTS PASSED' AS result;
