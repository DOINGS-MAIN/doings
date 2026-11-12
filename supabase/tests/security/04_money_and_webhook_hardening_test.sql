-- 107: PIN change counts wrong guesses; the admin refund is off; stored webhook secrets and unverified
-- payloads are gone; the send limit holds; an automatic FX rate that jumps is refused.
-- Run as: BEGIN; 04_…_before.sql; migration 107; tests/ads/_setup.sql; this file; ROLLBACK.

CREATE FUNCTION pg_temp.err(q text) RETURNS text LANGUAGE plpgsql AS $$
BEGIN EXECUTE q; RETURN NULL; EXCEPTION WHEN OTHERS THEN RETURN SQLSTATE || ' ' || SQLERRM; END $$;
-- Run a one-value query as p_role; returns the value as text.
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
    ('pin', pg_temp.mk_user('s107-pin@test.local', 0)),
    ('nopin', pg_temp.mk_user('s107-nopin@test.local', 0)),
    ('sender', pg_temp.mk_user('s107-sender@test.local', 1000000)),
    ('receiver', pg_temp.mk_user('s107-receiver@test.local', 0));
  UPDATE public.users SET transaction_pin_hash = extensions.crypt('1234', extensions.gen_salt('bf')), transaction_pin_set_at = now()
  WHERE id = (SELECT v FROM t WHERE k = 'pin');
  -- sending needs full verification (debit_wallet refuses below level 2)
  UPDATE public.users SET kyc_level = 2 WHERE id = (SELECT v FROM t WHERE k = 'sender');
END $$;

-- ── privileges ──────────────────────────────────────────────────────────────────────────────
DO $$
BEGIN
  ASSERT NOT has_function_privilege('anon', 'public.change_transaction_pin(text, text)', 'EXECUTE'), 'signed out cannot change a PIN';
  ASSERT has_function_privilege('authenticated', 'public.change_transaction_pin(text, text)', 'EXECUTE'), 'the app changes the PIN';
  ASSERT NOT has_function_privilege('authenticated', 'public.internal_transfer_checked(uuid, uuid, uuid, uuid, bigint, text, bigint)', 'EXECUTE'), 'clients cannot call the transfer';
  ASSERT NOT has_function_privilege('anon', 'public.internal_transfer_checked(uuid, uuid, uuid, uuid, bigint, text, bigint)', 'EXECUTE'), 'signed out cannot call the transfer';
  ASSERT has_function_privilege('service_role', 'public.internal_transfer_checked(uuid, uuid, uuid, uuid, bigint, text, bigint)', 'EXECUTE'), 'the transfer function calls it';
  ASSERT NOT has_function_privilege('authenticated', 'public.update_fx_market_rate(bigint, text, jsonb)', 'EXECUTE'), 'rate store stays server-only';
  ASSERT NOT has_function_privilege('authenticated', 'public.admin_refund_transaction(uuid, uuid, text)', 'EXECUTE'), 'refund stays server-only';
END $$;

-- ── changing the PIN: wrong guesses are kept and lock ───────────────────────────────────────
SELECT pg_temp.auth_as((SELECT v FROM t WHERE k = 'pin'));
DO $$
DECLARE u uuid := (SELECT v FROM t WHERE k = 'pin'); i int; q text := 'SELECT public.change_transaction_pin(%L, %L)';
BEGIN
  ASSERT pg_temp.text_as('authenticated', format(q, '12', '1234')) = 'PIN_FORMAT', 'new PIN must be 4 digits';
  FOR i IN 1..4 LOOP
    ASSERT pg_temp.text_as('authenticated', format(q, '9999', lpad(i::text, 4, '0'))) = 'INVALID_PIN', 'wrong guess ' || i;
  END LOOP;
  ASSERT (SELECT transaction_pin_failed_attempts FROM public.users WHERE id = u) = 4, 'each wrong guess is kept';
  ASSERT pg_temp.text_as('authenticated', format(q, '9999', '0005')) = 'PIN_LOCKED', 'the fifth locks';
  ASSERT (SELECT transaction_pin_locked_until > now() + interval '14 minutes' FROM public.users WHERE id = u), 'locked for 15 minutes';
  ASSERT pg_temp.text_as('authenticated', format(q, '9999', '1234')) = 'PIN_LOCKED', 'even the right PIN waits out the lock';
  ASSERT pg_temp.text_as('service_role', format('SELECT public.check_transaction_pin(%L, ''1234'')', u)) = 'PIN_LOCKED', 'paying is locked by the same counter';
  ASSERT (SELECT extensions.crypt('1234', transaction_pin_hash) = transaction_pin_hash FROM public.users WHERE id = u), 'the PIN did not change';

  UPDATE public.users SET transaction_pin_locked_until = now() - interval '1 second' WHERE id = u;
  ASSERT pg_temp.text_as('authenticated', format(q, '9999', '1234')) = 'OK', 'the right current PIN changes it';
  ASSERT pg_temp.text_as('service_role', format('SELECT public.check_transaction_pin(%L, ''9999'')', u)) = 'OK', 'the new PIN works';
  ASSERT (SELECT transaction_pin_failed_attempts = 0 AND transaction_pin_locked_until IS NULL FROM public.users WHERE id = u), 'a good change clears the count';
  ASSERT pg_temp.text_as('authenticated', format(q, '8888', NULL)) = 'INVALID_PIN', 'a missing current PIN is a wrong guess';

  -- the old function no longer changes an existing PIN
  ASSERT pg_temp.text_as('authenticated', 'SELECT public.set_transaction_pin(''7777'', ''9999'')') LIKE '%Update the app to change your transaction PIN', 'set_transaction_pin cannot change';
  ASSERT pg_temp.text_as('service_role', format('SELECT public.check_transaction_pin(%L, ''9999'')', u)) = 'OK', 'still the PIN set through change';
END $$;

-- a first PIN is still set the old way; change needs one to exist
SELECT pg_temp.auth_as((SELECT v FROM t WHERE k = 'nopin'));
DO $$
DECLARE u uuid := (SELECT v FROM t WHERE k = 'nopin');
BEGIN
  ASSERT pg_temp.text_as('authenticated', 'SELECT public.change_transaction_pin(''1111'', ''0000'')') = 'PIN_NOT_SET', 'nothing to change yet';
  ASSERT COALESCE(pg_temp.text_as('authenticated', 'SELECT public.set_transaction_pin(''1111'')'), '') = '', 'first PIN set';
  ASSERT pg_temp.text_as('service_role', format('SELECT public.check_transaction_pin(%L, ''1111'')', u)) = 'OK', 'first PIN works';
END $$;

-- ── the admin refund is off ─────────────────────────────────────────────────────────────────
DO $$
BEGIN
  ASSERT pg_temp.text_as('service_role', format('SELECT public.admin_refund_transaction(%L, %L, ''x'')', gen_random_uuid(), gen_random_uuid()))
    LIKE '%Transaction refunds are switched off', 'refund refuses';
END $$;

-- ── webhook log scrubbed (rows from 04_…_before.sql) ────────────────────────────────────────
DO $$
DECLARE r record;
BEGIN
  ASSERT NOT EXISTS (SELECT 1 FROM public.webhook_logs WHERE headers ? 'verif-hash' OR headers ? 'authorization' OR signature IS NOT NULL), 'no stored secret anywhere';
  ASSERT NOT EXISTS (SELECT 1 FROM public.webhook_logs WHERE headers::text LIKE '%t107-shared-secret%' OR payload::text LIKE '%t107-shared-secret%'), 'the secret value is gone';

  SELECT * INTO r FROM public.webhook_logs WHERE idempotency_key = 't107-real';
  ASSERT r.payload->'data'->>'tx_ref' = 't107-real', 'a verified payload is kept';
  ASSERT r.headers = '{"content-type":"application/json","user-agent":"FLW","x-forwarded-for":"1.2.3.4"}'::jsonb, 'three harmless headers kept';

  ASSERT NOT EXISTS (SELECT 1 FROM public.webhook_logs WHERE idempotency_key IN ('t107-forged', 't107-unknown')), 'unverified rows lose their key';
  ASSERT NOT EXISTS (SELECT 1 FROM public.webhook_logs WHERE payload::text LIKE '%victim-va%' OR payload::text LIKE '%DOINGS-WD-x%'), 'unverified payloads are gone';
  ASSERT (SELECT count(*) FROM public.webhook_logs WHERE signature_valid IS DISTINCT FROM true AND payload <> '{"unverified": true}'::jsonb) = 0, 'every unverified row is blank';
  ASSERT EXISTS (SELECT 1 FROM public.webhook_logs WHERE provider = 'flutterwave' AND signature_valid = false AND headers = '{"content-type":"application/json"}'::jsonb), 'the forged row remains as a blank record';
END $$;

-- ── sending: the limit is counted inside the lock ───────────────────────────────────────────
DO $$
DECLARE
  s uuid := (SELECT v FROM t WHERE k = 'sender'); r uuid := (SELECT v FROM t WHERE k = 'receiver');
  sw uuid := (SELECT id FROM public.wallets WHERE user_id = s AND currency = 'NGN');
  rw uuid := (SELECT id FROM public.wallets WHERE user_id = r AND currency = 'NGN');
  q text := 'SELECT public.internal_transfer_checked(%L, %L, %L, %L, %s, ''t'', %s)';
BEGIN
  ASSERT pg_temp.text_as('service_role', format(q, sw, rw, s, r, 300000, 500000)) ~ '^[0-9a-f-]{36}$', 'first send goes';
  ASSERT pg_temp.text_as('service_role', format(q, sw, rw, s, r, 300000, 500000)) LIKE '%DAILY_TRANSFER_LIMIT', 'the second would pass the limit';
  ASSERT pg_temp.text_as('service_role', format(q, sw, rw, s, r, 200000, 500000)) ~ '^[0-9a-f-]{36}$', 'exactly up to the limit goes';
  ASSERT pg_temp.text_as('service_role', format(q, sw, rw, s, r, 1, 500000)) LIKE '%DAILY_TRANSFER_LIMIT', 'nothing past it';
  ASSERT (SELECT balance FROM public.wallets WHERE id = sw) = 500000, 'sender debited only for what went';
  ASSERT (SELECT balance FROM public.wallets WHERE id = rw) = 500000, 'receiver credited the same';
  ASSERT pg_temp.text_as('service_role', format(q, sw, rw, s, r, 100, 0)) LIKE '%DAILY_TRANSFER_LIMIT', 'no limit means no sending';
  ASSERT pg_temp.text_as('service_role', format(q, rw, sw, s, r, 100, 500000)) LIKE '%Sender wallet not found', 'the wallet must be the sender''s';
  ASSERT pg_temp.text_as('service_role', format(q, sw, sw, s, r, 100, 900000)) LIKE '%Receiver wallet not found', 'the wallet must be the receiver''s';
  ASSERT pg_temp.text_as('service_role', format(q, sw, rw, s, r, 0, 500000)) LIKE '%Transfer amount must be positive', 'no zero sends';
END $$;

-- ── FX: a jump is refused, a manual rate is not ─────────────────────────────────────────────
DO $$
DECLARE j jsonb;
BEGIN
  UPDATE public.platform_settings SET fx_market_rate_kobo = 150000, fx_market_rate_updated_at = now() WHERE id = 1;

  j := public.update_fx_market_rate(160000, 'binance', '{}');
  ASSERT j->>'rejected' IS NULL AND (SELECT fx_market_rate_kobo FROM public.platform_settings WHERE id = 1) = 160000, 'a 7% move is accepted';

  j := public.update_fx_market_rate(300000, 'bybit', '{"note":"thin board"}');
  ASSERT (j->>'rejected')::boolean AND (j->>'market_rate_kobo')::bigint = 160000 AND (j->>'sell_rate_kobo')::bigint > 0, 'an 88% jump is refused and the old rate reported';
  ASSERT (SELECT fx_market_rate_kobo FROM public.platform_settings WHERE id = 1) = 160000, 'the rate in force is unchanged';
  ASSERT EXISTS (SELECT 1 FROM public.fx_rate_snapshots WHERE source = 'bybit:rejected' AND market_rate_kobo = 300000), 'the refusal is on record';

  j := public.update_fx_market_rate(80000, 'binance', '{}');
  ASSERT (j->>'rejected')::boolean, 'a 50% drop is refused too';
  ASSERT (SELECT count(*) FROM public.fx_rate_snapshots WHERE source LIKE '%:rejected' AND created_at > now() - interval '5 minutes') = 1,
    'repeated refusals leave one record per 5 minutes, not one per request';

  j := public.update_fx_market_rate(300000, 'manual', '{}');
  ASSERT j->>'rejected' IS NULL AND (SELECT fx_market_rate_kobo FROM public.platform_settings WHERE id = 1) = 300000, 'a manual rate is never refused';

  -- a rate over a day old allows a wider move (the market may really have moved)
  UPDATE public.platform_settings SET fx_market_rate_kobo = 150000, fx_market_rate_updated_at = now() - interval '2 days' WHERE id = 1;
  j := public.update_fx_market_rate(210000, 'binance', '{}');
  ASSERT (j->>'rejected')::boolean, '40% is refused even after two days';
  j := public.update_fx_market_rate(190000, 'binance', '{}');
  ASSERT j->>'rejected' IS NULL, '27% after two days is accepted';
END $$;

-- ── first-ever rate, and the cleanup job ────────────────────────────────────────────────────
DO $$
DECLARE j jsonb;
BEGIN
  UPDATE public.platform_settings SET fx_market_rate_kobo = NULL, fx_market_rate_updated_at = NULL WHERE id = 1;
  j := public.update_fx_market_rate(155000, 'binance', '{}');
  ASSERT j->>'rejected' IS NULL AND (SELECT fx_market_rate_kobo FROM public.platform_settings WHERE id = 1) = 155000, 'a first rate has nothing to be compared with';

  ASSERT (SELECT count(*) FROM cron.job WHERE jobname = 'rate-limit-cleanup' AND active) = 1, 'the cleanup is scheduled once';
  INSERT INTO public.rate_limit_hits (key, hit_at) VALUES ('s107-old', now() - interval '3 days'), ('s107-new', now());
  EXECUTE (SELECT command FROM cron.job WHERE jobname = 'rate-limit-cleanup');
  ASSERT NOT EXISTS (SELECT 1 FROM public.rate_limit_hits WHERE key = 's107-old'), 'old hits are cleared';
  ASSERT EXISTS (SELECT 1 FROM public.rate_limit_hits WHERE key = 's107-new'), 'recent hits stay';
END $$;

SELECT 'ALL 107 TESTS PASSED' AS result;
