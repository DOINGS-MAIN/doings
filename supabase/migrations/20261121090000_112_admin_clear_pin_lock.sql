-- 112: an admin can lift a person's transaction PIN lock (security release 3, part B).
--
-- A person locked out of their PIN (up to 24 hours on the ladder from 108) had no way back except
-- waiting or the email reset. Support and compliance can now lift the lock from the person's page.
-- The change, its audit record and the notice to the person happen together or not at all.
--
-- Limits, so the unlock cannot be turned into a way of guessing a PIN:
--   * only a lock that is running can be lifted. Wrong tries short of a lock are left alone: clearing
--     at four tries, again and again, would let someone guess without ever being locked.
--   * three unlocks per person in 24 hours, whoever the admin is.
--   * the PIN is not touched, and the lock ladder (transaction_pin_lockouts) is kept, so the next
--     lock is as long as it would have been.
--
-- Called only by the admin function (service_role), which has already checked the admin's role.

CREATE OR REPLACE FUNCTION public.admin_clear_pin_lock(p_user_id uuid, p_admin_auth_id uuid, p_ip inet DEFAULT NULL)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_attempts int;
  v_locked_until timestamptz;
  v_recent int;
BEGIN
  SELECT COALESCE(transaction_pin_failed_attempts, 0), transaction_pin_locked_until
    INTO v_attempts, v_locked_until
    FROM public.users WHERE id = p_user_id FOR UPDATE;
  IF NOT FOUND THEN RAISE EXCEPTION 'User not found'; END IF;

  IF v_locked_until IS NULL OR v_locked_until <= now() THEN
    RAISE EXCEPTION 'This person''s PIN is not locked';
  END IF;

  -- Counted under the row lock above, so two admins cannot both take the last one.
  SELECT count(*) INTO v_recent
    FROM public.admin_audit_log
   WHERE action = 'clear_pin_lock' AND target_type = 'user' AND target_id = p_user_id
     AND created_at > now() - interval '24 hours';
  IF v_recent >= 3 THEN
    RAISE EXCEPTION 'This PIN has been unlocked 3 times in the last 24 hours. The person can wait for the lock to end or reset the PIN by email.';
  END IF;

  UPDATE public.users
     SET transaction_pin_failed_attempts = 0, transaction_pin_locked_until = NULL
   WHERE id = p_user_id;

  PERFORM public.log_admin_action(p_admin_auth_id, 'clear_pin_lock', 'user', p_user_id,
    jsonb_build_object('failed_attempts', v_attempts, 'locked_until', v_locked_until), p_ip);

  -- The owner of the account hears about it, in case they did not ask.
  PERFORM public.create_notification(
    p_user_id, 'security', 'Transaction PIN unlocked',
    'Support unlocked your transaction PIN. If you did not ask for this, change your PIN and contact support.'
  );

  RETURN jsonb_build_object('user_id', p_user_id);
END;
$$;

REVOKE ALL ON FUNCTION public.admin_clear_pin_lock(uuid, uuid, inet) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.admin_clear_pin_lock(uuid, uuid, inet) TO service_role;
