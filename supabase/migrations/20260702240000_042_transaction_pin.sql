-- Migration 042: Transaction PIN (4-digit, bcrypt hash, server-verified)
-- =================================================================

ALTER TABLE public.users
  ADD COLUMN IF NOT EXISTS transaction_pin_hash TEXT,
  ADD COLUMN IF NOT EXISTS transaction_pin_set_at TIMESTAMPTZ,
  ADD COLUMN IF NOT EXISTS transaction_pin_failed_attempts SMALLINT NOT NULL DEFAULT 0,
  ADD COLUMN IF NOT EXISTS transaction_pin_locked_until TIMESTAMPTZ;

CREATE OR REPLACE FUNCTION public.has_transaction_pin()
RETURNS boolean
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path = public
AS $$
  SELECT transaction_pin_hash IS NOT NULL
  FROM public.users
  WHERE auth_id = auth.uid();
$$;

CREATE OR REPLACE FUNCTION public.set_transaction_pin(
  p_pin text,
  p_current_pin text DEFAULT NULL
)
RETURNS void
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  _user_id uuid;
  _existing_hash text;
BEGIN
  IF p_pin IS NULL OR p_pin !~ '^[0-9]{4}$' THEN
    RAISE EXCEPTION 'PIN must be exactly 4 digits';
  END IF;

  SELECT id, transaction_pin_hash
  INTO _user_id, _existing_hash
  FROM public.users
  WHERE auth_id = auth.uid()
  FOR UPDATE;

  IF _user_id IS NULL THEN
    RAISE EXCEPTION 'User not found';
  END IF;

  IF _existing_hash IS NOT NULL THEN
    IF p_current_pin IS NULL OR p_current_pin !~ '^[0-9]{4}$' THEN
      RAISE EXCEPTION 'Current PIN is required to change your transaction PIN';
    END IF;
    IF crypt(p_current_pin, _existing_hash) <> _existing_hash THEN
      RAISE EXCEPTION 'Current PIN is incorrect';
    END IF;
  END IF;

  UPDATE public.users
  SET transaction_pin_hash = crypt(p_pin, gen_salt('bf')),
      transaction_pin_set_at = now(),
      transaction_pin_failed_attempts = 0,
      transaction_pin_locked_until = NULL,
      updated_at = now()
  WHERE id = _user_id;
END;
$$;

CREATE OR REPLACE FUNCTION public.verify_transaction_pin_internal(
  p_user_id uuid,
  p_pin text
)
RETURNS void
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  _hash text;
  _attempts smallint;
  _locked_until timestamptz;
BEGIN
  IF p_pin IS NULL OR p_pin !~ '^[0-9]{4}$' THEN
    RAISE EXCEPTION 'PIN_REQUIRED';
  END IF;

  SELECT transaction_pin_hash, transaction_pin_failed_attempts, transaction_pin_locked_until
  INTO _hash, _attempts, _locked_until
  FROM public.users
  WHERE id = p_user_id
  FOR UPDATE;

  IF NOT FOUND THEN
    RAISE EXCEPTION 'User not found';
  END IF;

  IF _hash IS NULL THEN
    RAISE EXCEPTION 'PIN_NOT_SET';
  END IF;

  IF _locked_until IS NOT NULL AND _locked_until > now() THEN
    RAISE EXCEPTION 'PIN_LOCKED';
  END IF;

  IF crypt(p_pin, _hash) <> _hash THEN
    _attempts := COALESCE(_attempts, 0) + 1;
    UPDATE public.users
    SET transaction_pin_failed_attempts = _attempts,
        transaction_pin_locked_until = CASE
          WHEN _attempts >= 5 THEN now() + interval '15 minutes'
          ELSE NULL
        END,
        updated_at = now()
    WHERE id = p_user_id;

    IF _attempts >= 5 THEN
      RAISE EXCEPTION 'PIN_LOCKED';
    END IF;
    RAISE EXCEPTION 'INVALID_PIN';
  END IF;

  UPDATE public.users
  SET transaction_pin_failed_attempts = 0,
      transaction_pin_locked_until = NULL,
      updated_at = now()
  WHERE id = p_user_id;
END;
$$;

GRANT EXECUTE ON FUNCTION public.has_transaction_pin() TO authenticated;
GRANT EXECUTE ON FUNCTION public.set_transaction_pin(text, text) TO authenticated;
REVOKE ALL ON FUNCTION public.verify_transaction_pin_internal(uuid, text) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.verify_transaction_pin_internal(uuid, text) TO service_role;
