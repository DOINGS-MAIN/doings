-- 108: a repeated send pays once; PIN locks grow; codes come from a cryptographic source; a doubled
-- treasury top-up is refused; guessing event codes is limited.
-- Run as: BEGIN; migration 108; tests/ads/_setup.sql; this file; ROLLBACK.

CREATE FUNCTION pg_temp.text_as(p_role text, q text) RETURNS text LANGUAGE plpgsql AS $$
DECLARE v text;
BEGIN
  EXECUTE format('SET LOCAL ROLE %I', p_role);
  BEGIN EXECUTE q INTO v; EXCEPTION WHEN OTHERS THEN RESET ROLE; RETURN SQLSTATE || ' ' || SQLERRM; END;
  RESET ROLE; RETURN v;
END $$;

CREATE TEMP TABLE t (k text PRIMARY KEY, v uuid);
GRANT ALL ON t TO anon, authenticated, service_role;
DO $$
BEGIN
  INSERT INTO t VALUES
    ('pin', pg_temp.mk_user('s108-pin@test.local', 0)),
    ('sender', pg_temp.mk_user('s108-sender@test.local', 1000000)),
    ('receiver', pg_temp.mk_user('s108-receiver@test.local', 0)),
    ('other', pg_temp.mk_user('s108-other@test.local', 1000000)),
    ('host', pg_temp.mk_user('s108-host@test.local', 0)),
    ('guesser', pg_temp.mk_user('s108-guesser@test.local', 0)),
    ('finance', pg_temp.mk_admin('s108-finance@test.local', 'finance')),
    ('support', pg_temp.mk_admin('s108-support@test.local', 'support'));
  UPDATE public.users SET transaction_pin_hash = extensions.crypt('1234', extensions.gen_salt('bf')), transaction_pin_set_at = now()
  WHERE id = (SELECT v FROM t WHERE k = 'pin');
  -- sending needs full verification (debit_wallet refuses below level 2)
  UPDATE public.users SET kyc_level = 2 WHERE id IN (SELECT v FROM t WHERE k IN ('sender', 'other'));
END $$;

-- ── privileges ──────────────────────────────────────────────────────────────────────────────
DO $$
DECLARE sig text := 'public.internal_transfer_checked(uuid, uuid, uuid, uuid, bigint, text, bigint, text)';
BEGIN
  ASSERT to_regprocedure('public.internal_transfer_checked(uuid, uuid, uuid, uuid, bigint, text, bigint)') IS NULL, 'the 7-argument transfer is gone';
  ASSERT NOT has_function_privilege('anon', sig, 'EXECUTE') AND NOT has_function_privilege('authenticated', sig, 'EXECUTE'), 'clients cannot call the transfer';
  ASSERT has_function_privilege('service_role', sig, 'EXECUTE'), 'the transfer function calls it';
  ASSERT NOT has_function_privilege('authenticated', 'public.random_code(int)', 'EXECUTE'), 'clients cannot mint codes';
  ASSERT NOT has_function_privilege('authenticated', 'public.pin_lock_interval(int)', 'EXECUTE'), 'lock rule is server-only';
  ASSERT NOT has_function_privilege('authenticated', 'public.check_transaction_pin(uuid, text)', 'EXECUTE'), 'PIN check stays server-only';
  ASSERT NOT has_function_privilege('anon', 'public.change_transaction_pin(text, text)', 'EXECUTE'), 'signed out cannot change a PIN';
  ASSERT has_function_privilege('authenticated', 'public.change_transaction_pin(text, text)', 'EXECUTE'), 'the app changes the PIN';
  ASSERT NOT has_function_privilege('anon', 'public.get_event_view(uuid, text)', 'EXECUTE'), 'signed out cannot read event views';
  ASSERT has_function_privilege('authenticated', 'public.get_event_view(uuid, text)', 'EXECUTE'), 'the app reads event views';
  ASSERT NOT has_function_privilege('anon', 'public.record_treasury_topup(public.currency, bigint, text, text)', 'EXECUTE'), 'signed out cannot top up';
  ASSERT NOT has_column_privilege('authenticated', 'public.users', 'transaction_pin_lockouts', 'SELECT'), 'the lock count is not readable by clients';
  ASSERT NOT has_column_privilege('authenticated', 'public.users', 'transaction_pin_lockouts', 'UPDATE'), 'the lock count is not writable by clients';
  ASSERT NOT has_column_privilege('anon', 'public.users', 'transaction_pin_lockouts', 'SELECT'), 'nor by signed-out callers';
END $$;

-- ── sending: the same key pays once ─────────────────────────────────────────────────────────
DO $$
DECLARE
  s uuid := (SELECT v FROM t WHERE k = 'sender'); r uuid := (SELECT v FROM t WHERE k = 'receiver'); o uuid := (SELECT v FROM t WHERE k = 'other');
  sw uuid := (SELECT id FROM public.wallets WHERE user_id = s AND currency = 'NGN');
  rw uuid := (SELECT id FROM public.wallets WHERE user_id = r AND currency = 'NGN');
  ow uuid := (SELECT id FROM public.wallets WHERE user_id = o AND currency = 'NGN');
  q text := 'SELECT public.internal_transfer_checked(%L, %L, %L, %L, %s, ''t'', %s, %L)';
  q7 text := 'SELECT public.internal_transfer_checked(p_sender_wallet_id => %L, p_receiver_wallet_id => %L, p_sender_user_id => %L, p_receiver_user_id => %L, p_amount => %s, p_description => ''t'', p_daily_limit => %s)';
  first text; again text;
BEGIN
  first := pg_temp.text_as('service_role', format(q, sw, rw, s, r, 100000, 500000, 'attempt-key-0001'));
  ASSERT first ~ '^[0-9a-f-]{36}$', 'first send goes: ' || first;
  again := pg_temp.text_as('service_role', format(q, sw, rw, s, r, 100000, 500000, 'attempt-key-0001'));
  ASSERT again = first, 'the repeat returns the first transfer';
  ASSERT (SELECT balance FROM public.wallets WHERE id = sw) = 900000, 'sender debited once';
  ASSERT (SELECT balance FROM public.wallets WHERE id = rw) = 100000, 'receiver credited once';
  ASSERT (SELECT count(*) FROM public.transfers WHERE sender_user_id = s) = 1, 'one transfer on record';

  ASSERT pg_temp.text_as('service_role', format(q, sw, rw, s, r, 200000, 500000, 'attempt-key-0001')) LIKE '%IDEMPOTENCY_KEY_REUSED', 'the key cannot stand for a different amount';
  ASSERT pg_temp.text_as('service_role', format(q, sw, ow, s, o, 100000, 500000, 'attempt-key-0001')) LIKE '%IDEMPOTENCY_KEY_REUSED', 'nor for a different person';
  ASSERT (SELECT balance FROM public.wallets WHERE id = sw) = 900000, 'a refused reuse moves nothing';

  -- a repeat is answered even when the day's limit is now used up
  ASSERT pg_temp.text_as('service_role', format(q, sw, rw, s, r, 400000, 500000, 'attempt-key-0002')) ~ '^[0-9a-f-]{36}$', 'up to the limit goes';
  ASSERT pg_temp.text_as('service_role', format(q, sw, rw, s, r, 400000, 500000, 'attempt-key-0002')) ~ '^[0-9a-f-]{36}$', 'its repeat is still answered';
  ASSERT pg_temp.text_as('service_role', format(q, sw, rw, s, r, 1, 500000, 'attempt-key-0003')) LIKE '%DAILY_TRANSFER_LIMIT', 'a new send past the limit is refused';
  ASSERT (SELECT balance FROM public.wallets WHERE id = sw) = 500000, 'two sends, 500,000 kobo out';

  -- another sender may use the same key text
  ASSERT pg_temp.text_as('service_role', format(q, ow, rw, o, r, 100000, 500000, 'attempt-key-0001')) ~ '^[0-9a-f-]{36}$', 'keys are per sender';
  ASSERT (SELECT balance FROM public.wallets WHERE id = ow) = 900000, 'the other sender paid';

  -- no key: every call is a new send (the transfer function deployed before this release sends none)
  ASSERT pg_temp.text_as('service_role', format(q7, ow, rw, o, r, 100000, 500000)) ~ '^[0-9a-f-]{36}$', 'the 7-argument call still works';
  ASSERT pg_temp.text_as('service_role', format(q7, ow, rw, o, r, 100000, 500000)) ~ '^[0-9a-f-]{36}$', 'and is a new send each time';
  ASSERT (SELECT balance FROM public.wallets WHERE id = ow) = 700000, 'both went';
  ASSERT pg_temp.text_as('service_role', format(q, ow, rw, o, r, 100000, 500000, '')) ~ '^[0-9a-f-]{36}$', 'an empty key is no key';

  ASSERT pg_temp.text_as('service_role', format(q, ow, rw, o, r, 100, 500000, 'short')) LIKE '%Invalid idempotency key', 'a short key is refused';
  ASSERT pg_temp.text_as('service_role', format(q, ow, rw, o, r, 100, 500000, 'bad key with spaces')) LIKE '%Invalid idempotency key', 'a malformed key is refused';
  ASSERT (SELECT balance FROM public.wallets WHERE id = ow) = 600000, 'refused keys move nothing';
END $$;

-- ── PIN: each lock is longer than the last ──────────────────────────────────────────────────
DO $$
BEGIN
  ASSERT public.pin_lock_interval(1) = interval '15 minutes' AND public.pin_lock_interval(2) = interval '1 hour'
     AND public.pin_lock_interval(3) = interval '6 hours' AND public.pin_lock_interval(4) = interval '24 hours'
     AND public.pin_lock_interval(50) = interval '24 hours' AND public.pin_lock_interval(0) = interval '15 minutes'
     AND public.pin_lock_interval(NULL) = interval '15 minutes', 'the lock ladder';
END $$;

SELECT pg_temp.auth_as((SELECT v FROM t WHERE k = 'pin'));
DO $$
DECLARE
  u uuid := (SELECT v FROM t WHERE k = 'pin'); i int; n int;
  chk text := 'SELECT public.check_transaction_pin(%L, %L)';
  chg text := 'SELECT public.change_transaction_pin(%L, %L)';
  want interval[] := ARRAY[interval '15 minutes', interval '1 hour', interval '6 hours', interval '24 hours', interval '24 hours'];
BEGIN
  FOR n IN 1..5 LOOP
    FOR i IN 1..4 LOOP
      ASSERT pg_temp.text_as('service_role', format(chk, u, '000' || i)) = 'INVALID_PIN', format('round %s guess %s', n, i);
    END LOOP;
    -- the fifth guess of odd rounds comes through the PIN change, to show both share the ladder
    IF n % 2 = 1 THEN
      ASSERT pg_temp.text_as('authenticated', format(chg, '9999', '0005')) = 'PIN_LOCKED', format('round %s locks (change)', n);
    ELSE
      ASSERT pg_temp.text_as('service_role', format(chk, u, '0005')) = 'PIN_LOCKED', format('round %s locks (pay)', n);
    END IF;
    ASSERT (SELECT transaction_pin_lockouts FROM public.users WHERE id = u) = n, format('lock %s counted', n);
    ASSERT (SELECT transaction_pin_locked_until BETWEEN now() + want[n] - interval '1 minute' AND now() + want[n] + interval '1 minute'
            FROM public.users WHERE id = u), format('lock %s lasts %s', n, want[n]);
    ASSERT pg_temp.text_as('service_role', format(chk, u, '1234')) = 'PIN_LOCKED', 'the right PIN waits out the lock';
    UPDATE public.users SET transaction_pin_locked_until = now() - interval '1 second' WHERE id = u;
  END LOOP;

  -- one wrong guess after a lock does not lock again, and does not add to the count
  ASSERT pg_temp.text_as('service_role', format(chk, u, '0001')) = 'INVALID_PIN', 'a fresh window after the lock';
  ASSERT (SELECT transaction_pin_lockouts = 5 AND transaction_pin_locked_until IS NULL FROM public.users WHERE id = u), 'the count is kept, no lock yet';

  -- the right PIN clears everything
  ASSERT pg_temp.text_as('service_role', format(chk, u, '1234')) = 'OK', 'the right PIN is accepted';
  ASSERT (SELECT transaction_pin_lockouts = 0 AND transaction_pin_failed_attempts = 0 AND transaction_pin_locked_until IS NULL
          FROM public.users WHERE id = u), 'a correct PIN starts the ladder again';

  FOR i IN 1..4 LOOP
    ASSERT pg_temp.text_as('authenticated', format(chg, '9999', '000' || i)) = 'INVALID_PIN', 'wrong current PIN ' || i;
  END LOOP;
  ASSERT pg_temp.text_as('authenticated', format(chg, '9999', '0005')) = 'PIN_LOCKED', 'locks';
  ASSERT (SELECT transaction_pin_locked_until < now() + interval '16 minutes' FROM public.users WHERE id = u), 'back to the first rung';
  UPDATE public.users SET transaction_pin_locked_until = now() - interval '1 second' WHERE id = u;
  ASSERT pg_temp.text_as('authenticated', format(chg, '9999', '1234')) = 'OK', 'the right current PIN changes it';
  ASSERT (SELECT transaction_pin_lockouts = 0 FROM public.users WHERE id = u), 'a good change clears the count';
  ASSERT pg_temp.text_as('service_role', format(chk, u, '9999')) = 'OK', 'the new PIN works';
END $$;

-- ── codes ───────────────────────────────────────────────────────────────────────────────────
DO $$
DECLARE
  h uuid := (SELECT v FROM t WHERE k = 'host'); c text; codes text[] := '{}'; i int; ev uuid;
BEGIN
  FOR i IN 1..400 LOOP
    c := public.random_code(6);
    ASSERT c ~ '^[ABCDEFGHJKMNPQRSTUVWXYZ23456789]{6}$', 'six characters from the code alphabet: ' || c;
    codes := codes || c;
  END LOOP;
  ASSERT (SELECT count(DISTINCT x) FROM unnest(codes) x) >= 399, 'codes do not repeat';
  -- every one of the 31 characters turns up in 2,400 draws (each expected about 77 times)
  ASSERT (SELECT count(DISTINCT ch) FROM unnest(codes) x, regexp_split_to_table(x, '') ch) = 31, 'the whole alphabet is used';
  ASSERT length(public.random_code(1)) = 1 AND length(public.random_code(64)) = 64, 'any length up to 64';
  ASSERT pg_temp.text_as('service_role', 'SELECT public.random_code(0)') LIKE '%Invalid code length', 'no empty code';
  ASSERT pg_temp.text_as('service_role', 'SELECT public.random_code(65)') LIKE '%Invalid code length', 'no huge code';

  INSERT INTO public.events (host_id, title, type, status, is_private) VALUES (h, 's108 private', 'birthday', 'scheduled', true) RETURNING id, event_code INTO ev, c;
  ASSERT c ~ '^[ABCDEFGHJKMNPQRSTUVWXYZ23456789]{6}$', 'a new event gets a code: ' || COALESCE(c, 'null');
  INSERT INTO t VALUES ('event', ev);
  INSERT INTO public.events (host_id, title, type, status, event_code) VALUES (h, 's108 own code', 'birthday', 'scheduled', 'ZZZZ99') RETURNING event_code INTO c;
  ASSERT c = 'ZZZZ99', 'a given code is kept';
END $$;

-- ── guessing event codes ────────────────────────────────────────────────────────────────────
SELECT pg_temp.auth_as((SELECT v FROM t WHERE k = 'guesser'));
DO $$
DECLARE
  ev uuid := (SELECT v FROM t WHERE k = 'event');
  code text := (SELECT event_code FROM public.events WHERE id = (SELECT v FROM t WHERE k = 'event'));
  by_code text := 'SELECT count(*) FROM public.get_event_view(p_code => %L)';
  i int;
BEGIN
  -- real codes are never counted
  FOR i IN 1..40 LOOP
    ASSERT pg_temp.text_as('authenticated', format(by_code, code)) = '1', 'a real code is found, read ' || i;
  END LOOP;
  ASSERT pg_temp.text_as('authenticated', format(by_code, lower(left(code, 3)) || '-' || right(code, 3))) = '1', 'however it is typed';

  FOR i IN 1..20 LOOP
    ASSERT pg_temp.text_as('authenticated', format(by_code, 'QQQQ' || lpad(i::text, 2, '2'))) = '0', 'wrong code ' || i;
  END LOOP;
  ASSERT pg_temp.text_as('authenticated', format(by_code, 'QQQQ99')) LIKE '%Too many wrong codes%', 'the 21st wrong code waits';
  ASSERT pg_temp.text_as('authenticated', format(by_code, code)) LIKE '%Too many wrong codes%', 'and so does a right one, until the wait is over';
  ASSERT pg_temp.text_as('authenticated', format('SELECT count(*) FROM public.get_event_view(p_event_id => %L)', ev)) = '1', 'look-ups by id are not limited';

  UPDATE public.rate_limit_hits SET hit_at = now() - interval '11 minutes' WHERE key LIKE 'evcode-miss:%';
  ASSERT pg_temp.text_as('authenticated', format(by_code, code)) = '1', 'after the wait the code works again';
  ASSERT pg_temp.text_as('authenticated', 'SELECT count(*) FROM public.get_event_view()') LIKE '%event_id or code is required', 'one of the two is needed';
END $$;

-- another person is not held back by the guesser
SELECT pg_temp.auth_as((SELECT v FROM t WHERE k = 'host'));
DO $$
DECLARE r record;
BEGIN
  SELECT * INTO r FROM public.get_event_view(p_event_id => (SELECT v FROM t WHERE k = 'event'));
  ASSERT r.is_host AND r.is_private AND r.title = 's108 private' AND NOT r.is_joined AND r.event_code ~ '^[A-Z2-9]{6}$', 'the host sees their event as before';
END $$;

-- ── treasury top-up ─────────────────────────────────────────────────────────────────────────
SELECT pg_temp.auth_as((SELECT v FROM t WHERE k = 'finance'));
DO $$
DECLARE
  q text := 'SELECT public.record_treasury_topup(%L, %s, %L, ''s108'')';
  w uuid := public.get_treasury_wallet_id('NGN'); before bigint;
BEGIN
  SELECT balance INTO before FROM public.wallets WHERE id = w;
  ASSERT pg_temp.text_as('authenticated', format(q, 'NGN', 5000000, 'ref-1')) ~ '^[0-9a-f-]{36}$', 'the top-up is recorded';
  ASSERT pg_temp.text_as('authenticated', format(q, 'NGN', 5000000, 'ref-1')) LIKE '%already recorded a moment ago%', 'the double click is refused';
  ASSERT pg_temp.text_as('authenticated', format(q, 'NGN', 5000000, 'ref-2')) LIKE '%already recorded a moment ago%', 'whatever the reference';
  ASSERT (SELECT balance FROM public.wallets WHERE id = w) = before + 5000000, 'credited once';
  ASSERT pg_temp.text_as('authenticated', format(q, 'NGN', 5000001, 'ref-3')) ~ '^[0-9a-f-]{36}$', 'a different amount goes';
  ASSERT pg_temp.text_as('authenticated', format(q, 'USDC', 5000000, 'ref-4')) ~ '^[0-9a-f-]{36}$', 'a different currency goes';

  UPDATE public.treasury_topups SET created_at = now() - interval '3 minutes' WHERE note = 's108';
  ASSERT pg_temp.text_as('authenticated', format(q, 'NGN', 5000000, 'ref-5')) ~ '^[0-9a-f-]{36}$', 'the same amount goes again after two minutes';
  ASSERT pg_temp.text_as('authenticated', format(q, 'NGN', 0, 'ref-6')) LIKE '%Amount must be positive', 'no empty top-up';
  ASSERT (SELECT count(*) FROM public.admin_audit_log WHERE action = 'record_treasury_topup' AND created_at > now() - interval '1 minute') >= 4, 'each top-up is in the audit log';
END $$;

SELECT pg_temp.auth_as((SELECT v FROM t WHERE k = 'support'));
DO $$
BEGIN
  ASSERT pg_temp.text_as('authenticated', 'SELECT public.record_treasury_topup(''NGN'', 100, NULL, NULL)') LIKE '%Only finance or super admins%', 'support cannot top up';
END $$;

SELECT 'ALL 108 TESTS PASSED' AS result;
