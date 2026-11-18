-- 109: a forgotten transaction PIN can be replaced after proving the email address.
--
-- There was no way back from a forgotten PIN, and since 108 the locks grow to 24 hours. The app now
-- emails a sign-in code (Supabase one-time code) and, once it is entered, calls reset_transaction_pin.
-- The function accepts the call only from a session that was opened with an emailed code in the last
-- 10 minutes: a signed-in session alone (a stolen phone, a stolen token) is not enough, the inbox is
-- needed too.
--
-- RELEASE ORDER: this migration, then the app. Nothing deployed calls it yet.

CREATE FUNCTION public.reset_transaction_pin(p_pin text)
RETURNS text
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, extensions
AS $$
DECLARE
  _user_id uuid;
  _session_id uuid;
BEGIN
  IF p_pin IS NULL OR p_pin !~ '^[0-9]{4}$' THEN
    RETURN 'PIN_FORMAT';
  END IF;
  IF auth.uid() IS NULL THEN
    RETURN 'CODE_REQUIRED';
  END IF;

  -- The session this request is signed with, as recorded by the auth server (not a client claim).
  BEGIN
    _session_id := NULLIF(auth.jwt() ->> 'session_id', '')::uuid;
  EXCEPTION WHEN OTHERS THEN
    _session_id := NULL;
  END;
  IF _session_id IS NULL OR NOT EXISTS (
    SELECT 1
    FROM auth.sessions s
    JOIN auth.mfa_amr_claims c ON c.session_id = s.id
    WHERE s.id = _session_id AND s.user_id = auth.uid()
      AND c.authentication_method = 'otp'
      AND c.created_at > now() - interval '10 minutes'
  ) THEN
    RETURN 'CODE_REQUIRED';
  END IF;

  _user_id := public.ensure_auth_user_profile();

  -- Three resets a day: each one needs a fresh emailed code, this only bounds a compromised inbox.
  IF NOT public.consume_rate_limit('pin-reset:' || _user_id::text, 3, 86400) THEN
    RETURN 'TOO_MANY';
  END IF;

  UPDATE public.users
  SET transaction_pin_hash = crypt(p_pin, gen_salt('bf')),
      transaction_pin_set_at = now(),
      transaction_pin_failed_attempts = 0,
      transaction_pin_lockouts = 0,
      transaction_pin_locked_until = NULL,
      updated_at = now()
  WHERE id = _user_id;

  -- The owner of the account hears about it, in case it was not them.
  PERFORM public.create_notification(
    _user_id, 'security', 'Transaction PIN reset',
    'Your transaction PIN was reset with a code sent to your email. If this was not you, change your password and contact support.'
  );
  RETURN 'OK';
END;
$$;
REVOKE ALL ON FUNCTION public.reset_transaction_pin(text) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.reset_transaction_pin(text) TO authenticated, service_role;
