-- SECURITY: transaction PIN lockout never persisted. verify_transaction_pin_internal records a
-- failed attempt and then RAISEs, and the RAISE rolls back that UPDATE (one PostgREST call is
-- one transaction), so attempts were never counted and accounts never locked. Live data had 14
-- users with a PIN and no recorded failure or lock.
--
-- Additive fix:
--   * check_transaction_pin(user, pin) RETURNS text: same rules, but it *returns* a status, so
--     the failure count and lock commit. Edge functions switch to it via _shared/pin.ts. The old
--     verify_transaction_pin_internal is left untouched, so functions not yet redeployed keep
--     working.
--   * set_transaction_pin refuses PIN changes while the account is locked.
--   * rate_limit_hits + consume_rate_limit(key, max, window): DB-backed limiter (the edge limiter
--     is in-memory per isolate). get_giveaway_preview allows 30 lookups/min per user.

-- ── PIN check that persists failures ──
CREATE OR REPLACE FUNCTION public.check_transaction_pin(
  p_user_id uuid,
  p_pin text
)
RETURNS text
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, extensions
AS $$
DECLARE
  _hash text;
  _attempts smallint;
  _locked_until timestamptz;
BEGIN
  IF p_pin IS NULL OR p_pin !~ '^[0-9]{4}$' THEN
    RETURN 'PIN_REQUIRED';
  END IF;

  SELECT transaction_pin_hash, transaction_pin_failed_attempts, transaction_pin_locked_until
  INTO _hash, _attempts, _locked_until
  FROM public.users
  WHERE id = p_user_id
  FOR UPDATE;

  IF NOT FOUND THEN
    RETURN 'USER_NOT_FOUND';
  END IF;
  IF _hash IS NULL THEN
    RETURN 'PIN_NOT_SET';
  END IF;
  IF _locked_until IS NOT NULL AND _locked_until > now() THEN
    RETURN 'PIN_LOCKED';
  END IF;

  IF crypt(p_pin, _hash) <> _hash THEN
    -- A lock that has expired starts a fresh window of 5 attempts.
    _attempts := CASE
      WHEN _locked_until IS NOT NULL AND _locked_until <= now() THEN 1
      ELSE COALESCE(_attempts, 0) + 1
    END;
    UPDATE public.users
    SET transaction_pin_failed_attempts = _attempts,
        transaction_pin_locked_until = CASE
          WHEN _attempts >= 5 THEN now() + interval '15 minutes'
          ELSE NULL
        END,
        updated_at = now()
    WHERE id = p_user_id;
    RETURN CASE WHEN _attempts >= 5 THEN 'PIN_LOCKED' ELSE 'INVALID_PIN' END;
  END IF;

  UPDATE public.users
  SET transaction_pin_failed_attempts = 0,
      transaction_pin_locked_until = NULL,
      updated_at = now()
  WHERE id = p_user_id;
  RETURN 'OK';
END;
$$;

REVOKE ALL ON FUNCTION public.check_transaction_pin(uuid, text) FROM PUBLIC;
REVOKE ALL ON FUNCTION public.check_transaction_pin(uuid, text) FROM anon;
REVOKE ALL ON FUNCTION public.check_transaction_pin(uuid, text) FROM authenticated;
GRANT EXECUTE ON FUNCTION public.check_transaction_pin(uuid, text) TO service_role;

-- ── PIN changes blocked while locked (the current-PIN check itself can't count failures
--    without changing this RPC's contract for the current app) ──
CREATE OR REPLACE FUNCTION public.set_transaction_pin(
  p_pin text,
  p_current_pin text DEFAULT NULL
)
RETURNS void
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, extensions
AS $$
DECLARE
  _user_id uuid;
  _existing_hash text;
  _locked_until timestamptz;
BEGIN
  IF p_pin IS NULL OR p_pin !~ '^[0-9]{4}$' THEN
    RAISE EXCEPTION 'PIN must be exactly 4 digits';
  END IF;

  _user_id := public.ensure_auth_user_profile();

  SELECT transaction_pin_hash, transaction_pin_locked_until
  INTO _existing_hash, _locked_until
  FROM public.users
  WHERE id = _user_id
  FOR UPDATE;

  IF _existing_hash IS NOT NULL THEN
    IF _locked_until IS NOT NULL AND _locked_until > now() THEN
      RAISE EXCEPTION 'PIN_LOCKED';
    END IF;
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

-- ── DB-backed rate limiter ──
CREATE TABLE IF NOT EXISTS public.rate_limit_hits (
  key TEXT NOT NULL,
  hit_at TIMESTAMPTZ NOT NULL DEFAULT now()
);
CREATE INDEX IF NOT EXISTS idx_rate_limit_hits_key_time ON public.rate_limit_hits (key, hit_at);
ALTER TABLE public.rate_limit_hits ENABLE ROW LEVEL SECURITY;  -- no policies: definer / service only

CREATE OR REPLACE FUNCTION public.consume_rate_limit(p_key TEXT, p_max INT, p_window_seconds INT)
RETURNS BOOLEAN
LANGUAGE plpgsql
VOLATILE
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_count INT;
BEGIN
  DELETE FROM public.rate_limit_hits
  WHERE key = p_key AND hit_at < now() - make_interval(secs => p_window_seconds);

  SELECT count(*) INTO v_count FROM public.rate_limit_hits WHERE key = p_key;
  IF v_count >= p_max THEN
    RETURN false;
  END IF;

  INSERT INTO public.rate_limit_hits (key) VALUES (p_key);
  RETURN true;
END;
$$;

REVOKE ALL ON FUNCTION public.consume_rate_limit(TEXT, INT, INT) FROM PUBLIC;
REVOKE ALL ON FUNCTION public.consume_rate_limit(TEXT, INT, INT) FROM anon;
REVOKE ALL ON FUNCTION public.consume_rate_limit(TEXT, INT, INT) FROM authenticated;
GRANT EXECUTE ON FUNCTION public.consume_rate_limit(TEXT, INT, INT) TO service_role;

-- ── Throttled giveaway preview (30 lookups / minute / user) ──
CREATE OR REPLACE FUNCTION public.get_giveaway_preview(p_code TEXT)
RETURNS TABLE (
  id UUID,
  title TEXT,
  status public.giveaway_status,
  per_person_amount BIGINT,
  spots_left INT,
  creator_name TEXT,
  is_mine BOOLEAN,
  already_claimed BOOLEAN
)
LANGUAGE plpgsql
VOLATILE
SECURITY DEFINER
SET search_path = public
AS $$
#variable_conflict use_column
DECLARE
  v_caller UUID;
  v_code TEXT := NULLIF(upper(regexp_replace(COALESCE(p_code, ''), '[\s-]', '', 'g')), '');
BEGIN
  IF v_code IS NULL THEN
    RETURN;
  END IF;
  SELECT u.id INTO v_caller FROM public.users u WHERE u.auth_id = auth.uid();
  IF v_caller IS NULL THEN
    RETURN;
  END IF;

  IF NOT public.consume_rate_limit('giveaway-preview:' || v_caller::text, 30, 60) THEN
    RAISE EXCEPTION 'Too many code lookups. Try again in a minute.';
  END IF;

  RETURN QUERY
  SELECT
    g.id,
    g.title::TEXT,
    g.status,
    g.per_person_amount,
    CASE WHEN g.status = 'active' THEN (g.remaining_amount / g.per_person_amount)::INT ELSE 0 END,
    public.giveaway_creator_name(cu.full_name, cu.username),
    COALESCE(g.creator_id = v_caller, false),
    EXISTS (
      SELECT 1 FROM public.giveaway_redemptions r WHERE r.giveaway_id = g.id AND r.user_id = v_caller
    )
  FROM public.giveaways g
  JOIN public.users cu ON cu.id = g.creator_id
  WHERE g.code = v_code
  LIMIT 1;
END;
$$;
