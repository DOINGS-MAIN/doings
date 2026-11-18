-- 108: security release 3, part A (audit of 2026-11-12): a repeated send request pays once, PIN locks
-- grow longer, event and giveaway codes come from a cryptographic source, a doubled treasury top-up is
-- refused, and guessing event codes is limited.
--
-- RELEASE ORDER:
--   1. this migration. The transfer function already deployed keeps working: the new argument of
--      internal_transfer_checked has a default;
--   2. the functions (the new `transfer` passes the key, so it needs step 1);
--   3. the app (it sends the key; the old `transfer` ignores it, so the app can also go first).
--
-- BEFORE APPLYING: four functions are re-created from the migration named beside each. Diff each one
-- against pg_get_functiondef(...) on the live database:
--   check_transaction_pin(uuid,text)            073
--   change_transaction_pin(text,text)           107
--   record_treasury_topup(currency,bigint,text,text)  047
--   get_event_view(uuid,text)                   066

-- ── 1. Sending: a repeated request pays once ───────────────────────────────────────────────────
-- A send that timed out on the phone and was tapped again went out twice. The app now sends one key
-- per attempt; the same key from the same sender returns the first transfer instead of making another.
ALTER TABLE public.transfers ADD COLUMN IF NOT EXISTS idempotency_key TEXT;
CREATE UNIQUE INDEX IF NOT EXISTS idx_transfers_sender_idempotency
  ON public.transfers (sender_user_id, idempotency_key)
  WHERE idempotency_key IS NOT NULL;

DROP FUNCTION public.internal_transfer_checked(uuid, uuid, uuid, uuid, bigint, text, bigint);
CREATE FUNCTION public.internal_transfer_checked(
  p_sender_wallet_id UUID,
  p_receiver_wallet_id UUID,
  p_sender_user_id UUID,
  p_receiver_user_id UUID,
  p_amount BIGINT,
  p_description TEXT,
  p_daily_limit BIGINT,
  p_idempotency_key TEXT DEFAULT NULL
)
RETURNS UUID
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_currency public.currency;
  v_spent BIGINT;
  v_key TEXT := NULLIF(p_idempotency_key, '');
  v_existing public.transfers%ROWTYPE;
  v_transfer_id UUID;
BEGIN
  IF p_amount IS NULL OR p_amount <= 0 THEN
    RAISE EXCEPTION 'Transfer amount must be positive';
  END IF;
  IF v_key IS NOT NULL AND v_key !~ '^[A-Za-z0-9_-]{8,64}$' THEN
    RAISE EXCEPTION 'Invalid idempotency key';
  END IF;

  -- The same lock serialises a sender's requests, so the look-up below cannot race a twin request.
  PERFORM pg_advisory_xact_lock(hashtext('send:' || p_sender_user_id::text));

  IF v_key IS NOT NULL THEN
    SELECT * INTO v_existing FROM public.transfers
    WHERE sender_user_id = p_sender_user_id AND idempotency_key = v_key;
    IF FOUND THEN
      -- A key is one attempt at one send. Reused for a different send, it is a client fault: refuse
      -- instead of answering "done" for money that never moved.
      IF v_existing.receiver_user_id <> p_receiver_user_id OR v_existing.amount <> p_amount
         OR v_existing.sender_wallet_id <> p_sender_wallet_id THEN
        RAISE EXCEPTION 'IDEMPOTENCY_KEY_REUSED';
      END IF;
      RETURN v_existing.id;
    END IF;
  END IF;

  SELECT currency INTO v_currency FROM public.wallets
  WHERE id = p_sender_wallet_id AND user_id = p_sender_user_id;
  IF NOT FOUND THEN
    RAISE EXCEPTION 'Sender wallet not found';
  END IF;
  IF NOT EXISTS (SELECT 1 FROM public.wallets
                 WHERE id = p_receiver_wallet_id AND user_id = p_receiver_user_id AND currency = v_currency) THEN
    RAISE EXCEPTION 'Receiver wallet not found';
  END IF;

  -- Same window and statuses as the function's pre-check (limits.ts): today, UTC.
  SELECT COALESCE(sum(abs(amount)), 0) INTO v_spent
  FROM public.transactions
  WHERE user_id = p_sender_user_id AND currency = v_currency AND type = 'send'
    AND status IN ('completed', 'pending', 'processing')
    AND created_at >= date_trunc('day', now() AT TIME ZONE 'UTC') AT TIME ZONE 'UTC';

  IF v_spent + p_amount > COALESCE(p_daily_limit, 0) THEN
    RAISE EXCEPTION 'DAILY_TRANSFER_LIMIT';
  END IF;

  v_transfer_id := public.internal_transfer(
    p_sender_wallet_id, p_receiver_wallet_id, p_sender_user_id, p_receiver_user_id,
    p_amount, 0::bigint, COALESCE(p_description, 'Internal transfer'), 'send'::public.transaction_type
  );
  IF v_key IS NOT NULL THEN
    UPDATE public.transfers SET idempotency_key = v_key WHERE id = v_transfer_id;
  END IF;
  RETURN v_transfer_id;
END;
$$;
REVOKE ALL ON FUNCTION public.internal_transfer_checked(uuid, uuid, uuid, uuid, bigint, text, bigint, text) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.internal_transfer_checked(uuid, uuid, uuid, uuid, bigint, text, bigint, text) TO service_role;

-- ── 2. PIN: each lock is longer than the last ──────────────────────────────────────────────────
-- Five wrong guesses locked for 15 minutes and the count started again, about 480 guesses a day against
-- 10,000 possible PINs. Locks now grow (15 minutes, 1 hour, 6 hours, then 24 hours each) until a correct
-- PIN is entered: about 20 guesses on the first day and 5 a day after that.
ALTER TABLE public.users ADD COLUMN IF NOT EXISTS transaction_pin_lockouts SMALLINT NOT NULL DEFAULT 0;
-- users is granted to clients column by column (074, 105, 106), so the new column is not readable or
-- writable by them.

CREATE OR REPLACE FUNCTION public.pin_lock_interval(p_lockouts INT)
RETURNS INTERVAL
LANGUAGE sql
IMMUTABLE
SET search_path = public
AS $$
  SELECT CASE
    WHEN COALESCE(p_lockouts, 1) <= 1 THEN interval '15 minutes'
    WHEN p_lockouts = 2 THEN interval '1 hour'
    WHEN p_lockouts = 3 THEN interval '6 hours'
    ELSE interval '24 hours'
  END
$$;
REVOKE ALL ON FUNCTION public.pin_lock_interval(int) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.pin_lock_interval(int) TO service_role;

-- From 073, with the growing lock.
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
  _lockouts smallint;
BEGIN
  IF p_pin IS NULL OR p_pin !~ '^[0-9]{4}$' THEN
    RETURN 'PIN_REQUIRED';
  END IF;

  SELECT transaction_pin_hash, transaction_pin_failed_attempts, transaction_pin_locked_until, transaction_pin_lockouts
  INTO _hash, _attempts, _locked_until, _lockouts
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
    -- A lock that has expired starts a fresh window of 5 attempts; the number of locks so far is kept.
    _attempts := CASE
      WHEN _locked_until IS NOT NULL AND _locked_until <= now() THEN 1
      ELSE COALESCE(_attempts, 0) + 1
    END;
    IF _attempts >= 5 THEN
      _lockouts := LEAST(COALESCE(_lockouts, 0) + 1, 100);
    END IF;
    UPDATE public.users
    SET transaction_pin_failed_attempts = _attempts,
        transaction_pin_lockouts = COALESCE(_lockouts, 0),
        transaction_pin_locked_until = CASE
          WHEN _attempts >= 5 THEN now() + public.pin_lock_interval(_lockouts)
          ELSE NULL
        END,
        updated_at = now()
    WHERE id = p_user_id;
    RETURN CASE WHEN _attempts >= 5 THEN 'PIN_LOCKED' ELSE 'INVALID_PIN' END;
  END IF;

  UPDATE public.users
  SET transaction_pin_failed_attempts = 0,
      transaction_pin_lockouts = 0,
      transaction_pin_locked_until = NULL,
      updated_at = now()
  WHERE id = p_user_id;
  RETURN 'OK';
END;
$$;

-- From 107, with the growing lock.
CREATE OR REPLACE FUNCTION public.change_transaction_pin(p_pin text, p_current_pin text)
RETURNS text
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, extensions
AS $$
DECLARE
  _user_id uuid;
  _hash text;
  _attempts smallint;
  _locked_until timestamptz;
  _lockouts smallint;
BEGIN
  IF p_pin IS NULL OR p_pin !~ '^[0-9]{4}$' THEN
    RETURN 'PIN_FORMAT';
  END IF;

  _user_id := public.ensure_auth_user_profile();

  SELECT transaction_pin_hash, transaction_pin_failed_attempts, transaction_pin_locked_until, transaction_pin_lockouts
  INTO _hash, _attempts, _locked_until, _lockouts
  FROM public.users
  WHERE id = _user_id
  FOR UPDATE;

  IF _hash IS NULL THEN
    RETURN 'PIN_NOT_SET';
  END IF;
  IF _locked_until IS NOT NULL AND _locked_until > now() THEN
    RETURN 'PIN_LOCKED';
  END IF;

  IF p_current_pin IS NULL OR p_current_pin !~ '^[0-9]{4}$' OR crypt(p_current_pin, _hash) <> _hash THEN
    -- A lock that has expired starts a fresh window of 5 attempts (as check_transaction_pin).
    _attempts := CASE
      WHEN _locked_until IS NOT NULL AND _locked_until <= now() THEN 1
      ELSE COALESCE(_attempts, 0) + 1
    END;
    IF _attempts >= 5 THEN
      _lockouts := LEAST(COALESCE(_lockouts, 0) + 1, 100);
    END IF;
    UPDATE public.users
    SET transaction_pin_failed_attempts = _attempts,
        transaction_pin_lockouts = COALESCE(_lockouts, 0),
        transaction_pin_locked_until = CASE WHEN _attempts >= 5 THEN now() + public.pin_lock_interval(_lockouts) ELSE NULL END,
        updated_at = now()
    WHERE id = _user_id;
    RETURN CASE WHEN _attempts >= 5 THEN 'PIN_LOCKED' ELSE 'INVALID_PIN' END;
  END IF;

  UPDATE public.users
  SET transaction_pin_hash = crypt(p_pin, gen_salt('bf')),
      transaction_pin_set_at = now(),
      transaction_pin_failed_attempts = 0,
      transaction_pin_lockouts = 0,
      transaction_pin_locked_until = NULL,
      updated_at = now()
  WHERE id = _user_id;
  RETURN 'OK';
END;
$$;

-- ── 3. Event and giveaway codes from a cryptographic source ────────────────────────────────────
-- Both were built with random(), which is not meant for secrets: its sequence can be worked out from
-- a few outputs. Same 6 characters and alphabet (the app's code boxes are unchanged).
CREATE OR REPLACE FUNCTION public.random_code(p_length INT)
RETURNS TEXT
LANGUAGE plpgsql
VOLATILE
SET search_path = public, extensions
AS $$
DECLARE
  chars CONSTANT TEXT := 'ABCDEFGHJKMNPQRSTUVWXYZ23456789';   -- 31
  v_code TEXT := '';
  v_bytes BYTEA;
  v_byte INT;
  i INT;
BEGIN
  IF p_length IS NULL OR p_length < 1 OR p_length > 64 THEN
    RAISE EXCEPTION 'Invalid code length';
  END IF;
  WHILE length(v_code) < p_length LOOP
    v_bytes := gen_random_bytes(16);
    FOR i IN 0..15 LOOP
      v_byte := get_byte(v_bytes, i);
      -- 248 = 8 × 31: bytes above it are dropped so every character is equally likely.
      IF v_byte < 248 AND length(v_code) < p_length THEN
        v_code := v_code || substr(chars, (v_byte % 31) + 1, 1);
      END IF;
    END LOOP;
  END LOOP;
  RETURN v_code;
END;
$$;
REVOKE ALL ON FUNCTION public.random_code(int) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.random_code(int) TO service_role;

CREATE OR REPLACE FUNCTION public.generate_event_code()
RETURNS TRIGGER
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  generated_code TEXT;
BEGIN
  IF NEW.event_code IS NULL OR NEW.event_code = '' THEN
    LOOP
      generated_code := public.random_code(6);
      EXIT WHEN NOT EXISTS (SELECT 1 FROM public.events WHERE event_code = generated_code);
    END LOOP;
    NEW.event_code := generated_code;
  END IF;
  RETURN NEW;
END;
$$;

CREATE OR REPLACE FUNCTION public.generate_giveaway_code()
RETURNS TRIGGER
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  generated_code TEXT;
BEGIN
  IF NEW.code IS NULL OR NEW.code = '' THEN
    LOOP
      generated_code := public.random_code(6);
      EXIT WHEN NOT EXISTS (SELECT 1 FROM public.giveaways WHERE code = generated_code);
    END LOOP;
    NEW.code := generated_code;
  END IF;
  RETURN NEW;
END;
$$;
-- Trigger functions: nothing calls them directly.
REVOKE ALL ON FUNCTION public.generate_event_code() FROM PUBLIC, anon, authenticated;
REVOKE ALL ON FUNCTION public.generate_giveaway_code() FROM PUBLIC, anon, authenticated;

-- ── 4. Treasury top-up: a double click is refused ──────────────────────────────────────────────
-- From 047. The same admin recording the same currency and amount twice within two minutes is taken
-- for a repeat (the panel has no key to send); a real second top-up of the same size waits or differs.
CREATE OR REPLACE FUNCTION public.record_treasury_topup(
  p_currency public.currency,
  p_amount bigint,
  p_reference text DEFAULT NULL,
  p_note text DEFAULT NULL
)
RETURNS uuid
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  _admin_id uuid := auth.uid();
  v_wallet_id uuid;
  v_txn_id uuid;
  v_topup_id uuid;
  v_treasury_user uuid := '00000000-0000-4000-8000-000000000001';
BEGIN
  IF NOT (
    public.has_admin_role(_admin_id, 'super_admin')
    OR public.has_admin_role(_admin_id, 'finance')
  ) THEN
    RAISE EXCEPTION 'Only finance or super admins can record treasury top-ups';
  END IF;

  IF p_amount <= 0 THEN
    RAISE EXCEPTION 'Amount must be positive';
  END IF;

  -- 108: one top-up at a time, and no identical one straight after.
  PERFORM pg_advisory_xact_lock(hashtext('treasury-topup'));
  IF EXISTS (
    SELECT 1 FROM public.treasury_topups
    WHERE recorded_by = _admin_id AND currency = p_currency AND amount = p_amount
      AND created_at > now() - interval '2 minutes'
  ) THEN
    RAISE EXCEPTION 'This top-up was already recorded a moment ago. Check the list before recording it again.';
  END IF;

  v_wallet_id := public.get_treasury_wallet_id(p_currency);
  IF v_wallet_id IS NULL THEN
    RAISE EXCEPTION 'Treasury wallet not found for %', p_currency;
  END IF;

  v_txn_id := public.credit_wallet(
    v_wallet_id,
    v_treasury_user,
    p_amount,
    0,
    'deposit',
    COALESCE(p_note, 'Treasury top-up'),
    'internal',
    p_reference,
    'treasury-topup-' || gen_random_uuid()::text,
    jsonb_build_object('treasury_topup', true, 'recorded_by', _admin_id)
  );

  INSERT INTO public.treasury_topups (currency, amount, reference, note, recorded_by, transaction_id)
  VALUES (p_currency, p_amount, p_reference, p_note, _admin_id, v_txn_id)
  RETURNING id INTO v_topup_id;

  PERFORM public.log_admin_action(
    _admin_id,
    'record_treasury_topup',
    'treasury_topups',
    v_topup_id,
    jsonb_build_object('currency', p_currency, 'amount', p_amount, 'reference', p_reference)
  );

  RETURN v_topup_id;
END;
$$;

-- ── 5. Guessing event codes is limited ─────────────────────────────────────────────────────────
-- get_event_view answers for private events too (a guest with the code must see it), and a client can
-- call it as fast as it likes, so the six-character codes could be tried in bulk. Only wrong codes are
-- counted (20 in 10 minutes per person, then look-ups by code wait): a screen or page that re-reads a
-- real event is never slowed. Look-ups by id (unguessable) are not limited. From 066: only the limit
-- and VOLATILE (a wrong code now writes a hit) are new.
CREATE OR REPLACE FUNCTION public.get_event_view(
  p_event_id UUID DEFAULT NULL,
  p_code TEXT DEFAULT NULL
)
RETURNS TABLE (
  id UUID,
  host_id UUID,
  title TEXT,
  type public.event_type,
  description TEXT,
  location TEXT,
  event_date DATE,
  event_time TIME,
  scheduled_at TIMESTAMPTZ,
  event_code TEXT,
  status public.event_status,
  is_private BOOLEAN,
  max_participants INT,
  participant_count INT,
  total_sprayed BIGINT,
  cover_url TEXT,
  started_at TIMESTAMPTZ,
  ended_at TIMESTAMPTZ,
  created_at TIMESTAMPTZ,
  host_username TEXT,
  host_full_name TEXT,
  host_avatar_url TEXT,
  is_host BOOLEAN,
  is_joined BOOLEAN
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
  v_limit_key TEXT := 'evcode-miss:' || auth.uid()::text;   -- NULL for a server-side caller
BEGIN
  IF (p_event_id IS NULL) = (v_code IS NULL) THEN
    RAISE EXCEPTION 'event_id or code is required';
  END IF;

  IF v_code IS NOT NULL AND v_limit_key IS NOT NULL AND (
    SELECT count(*) FROM public.rate_limit_hits
    WHERE key = v_limit_key AND hit_at > now() - interval '10 minutes'
  ) >= 20 THEN
    RAISE EXCEPTION 'Too many wrong codes. Wait a few minutes and try again.';
  END IF;

  SELECT u.id INTO v_caller FROM public.users u WHERE u.auth_id = auth.uid();

  RETURN QUERY
  SELECT
    e.id,
    e.host_id,
    e.title::TEXT,
    e.type,
    e.description,
    e.location::TEXT,
    e.event_date,
    e.event_time,
    e.scheduled_at,
    e.event_code::TEXT,
    e.status,
    COALESCE(e.is_private, false),
    e.max_participants,
    e.participant_count,
    e.total_sprayed,
    e.cover_url,
    e.started_at,
    e.ended_at,
    e.created_at,
    h.username::TEXT,
    h.full_name::TEXT,
    h.avatar_url,
    COALESCE(e.host_id = v_caller, false),
    (mp.id IS NOT NULL)
  FROM public.events e
  JOIN public.users h ON h.id = e.host_id
  LEFT JOIN public.event_participants mp
    ON mp.event_id = e.id AND mp.user_id = v_caller AND mp.role <> 'host'
  WHERE (p_event_id IS NOT NULL AND e.id = p_event_id)
     OR (v_code IS NOT NULL AND e.event_code = v_code)
  LIMIT 1;

  IF NOT FOUND AND v_code IS NOT NULL AND v_limit_key IS NOT NULL THEN
    PERFORM public.consume_rate_limit(v_limit_key, 20, 600);
  END IF;
END;
$$;
