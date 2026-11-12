-- 106: the doors the 2026-11-12 audit found are shut, and the paths the apps use still work.
-- Uses tests/ads/_setup.sql (mk_user, mk_admin, auth_as).

-- Run q as p_role; NULL when it worked, else "SQLSTATE message".
CREATE FUNCTION pg_temp.run_as(p_role text, q text) RETURNS text LANGUAGE plpgsql AS $$
BEGIN
  EXECUTE format('SET LOCAL ROLE %I', p_role);
  BEGIN EXECUTE q; EXCEPTION WHEN OTHERS THEN RESET ROLE; RETURN SQLSTATE || ' ' || SQLERRM; END;
  RESET ROLE; RETURN NULL;
END $$;
-- Run a "SELECT count(*)…" as p_role and return the number.
CREATE FUNCTION pg_temp.count_as(p_role text, q text) RETURNS bigint LANGUAGE plpgsql AS $$
DECLARE n bigint;
BEGIN
  EXECUTE format('SET LOCAL ROLE %I', p_role);
  EXECUTE q INTO n;
  RESET ROLE; RETURN n;
END $$;
CREATE FUNCTION pg_temp.mk_event(p_host uuid, p_status text, p_private boolean, p_max int DEFAULT NULL) RETURNS uuid
LANGUAGE sql AS $$
  INSERT INTO public.events (host_id, title, type, event_code, status, is_private, max_participants)
  VALUES (p_host, 'Sec 106', 'party', upper(substr(md5(random()::text), 1, 6)), p_status::public.event_status, p_private, p_max)
  RETURNING id
$$;
CREATE FUNCTION pg_temp.mk_giveaway(p_creator uuid, p_code text, p_event uuid, p_private boolean DEFAULT false) RETURNS uuid
LANGUAGE sql AS $$
  INSERT INTO public.giveaways (creator_id, title, total_amount, per_person_amount, remaining_amount, code, status, type, event_id, is_private)
  VALUES (p_creator, 'Sec 106', 50000, 10000, 50000, p_code, 'active', 'live', p_event, p_private)
  RETURNING id
$$;

-- ── privileges ──────────────────────────────────────────────────────────────────────────────
DO $$
DECLARE f text; r text; leak text;
BEGIN
  -- server only
  FOREACH f IN ARRAY ARRAY[
    'public.verify_transaction_pin_internal(uuid, text)', 'public.create_notification(uuid, varchar, varchar, text, jsonb)',
    'public.refresh_leaderboards()', 'public.fx_user_daily_volume_usdc_micro(uuid)', 'public.get_treasury_wallet_id(public.currency)',
    'public.redeem_giveaway_code(uuid, text)'
  ] LOOP
    FOREACH r IN ARRAY ARRAY['anon', 'authenticated'] LOOP
      ASSERT NOT has_function_privilege(r, f, 'EXECUTE'), format('%s must not call %s', r, f);
    END LOOP;
    ASSERT has_function_privilege('service_role', f, 'EXECUTE'), format('server still calls %s', f);
  END LOOP;

  -- signed in only
  FOREACH f IN ARRAY ARRAY[
    'public.is_any_admin(uuid)', 'public.has_admin_role(uuid, public.admin_role)', 'public.set_transaction_pin(text, text)',
    'public.has_transaction_pin()', 'public.ensure_auth_user_profile()', 'public.set_username(text)',
    'public.is_username_available(text, uuid)', 'public.set_psp_env(text)', 'public.get_withdrawal_fee_settings()',
    'public.get_my_live_events_for_giveaway()', 'public.record_treasury_topup(public.currency, bigint, text, text)'
  ] LOOP
    ASSERT NOT has_function_privilege('anon', f, 'EXECUTE'), format('signed out must not call %s', f);
    ASSERT has_function_privilege('authenticated', f, 'EXECUTE'), format('signed in still calls %s', f);
  END LOOP;

  -- the signed-out big screen and invite page keep working
  FOREACH f IN ARRAY ARRAY[
    'public.get_event_floor(uuid)', 'public.get_event_top_gifters(uuid, integer)', 'public.get_event_screen_giveaways(uuid)',
    'public.get_event_live_spray_holds(uuid)', 'public.get_invite_preview(text, text)', 'public.get_event_spray_feed(uuid, integer)'
  ] LOOP
    ASSERT has_function_privilege('anon', f, 'EXECUTE'), format('screen still calls %s', f);
  END LOOP;

  -- nothing that runs as the caller depends on a function the caller just lost
  SELECT string_agg(p.proname, ', ') INTO leak FROM pg_proc p
  WHERE p.pronamespace = 'public'::regnamespace AND NOT p.prosecdef
    AND p.prosrc ~ '(create_notification|verify_transaction_pin_internal|refresh_leaderboards|fx_user_daily_volume_usdc_micro|get_treasury_wallet_id)\s*\(';
  ASSERT leak IS NULL, 'caller-rights functions use a server-only function: ' || leak;

  SELECT string_agg(p.proname, ', ') INTO leak FROM pg_proc p
  WHERE p.pronamespace = 'public'::regnamespace AND p.prosecdef
    AND NOT EXISTS (SELECT 1 FROM unnest(COALESCE(p.proconfig, '{}')) c WHERE c LIKE 'search_path=%');
  ASSERT leak IS NULL, 'definer functions without a search_path: ' || leak;

  -- tables and columns
  FOREACH r IN ARRAY ARRAY['anon', 'authenticated'] LOOP
    ASSERT NOT has_table_privilege(r, 'public.leaderboard_alltime', 'SELECT'), r || ' reads the leaderboard';
    ASSERT NOT has_table_privilege(r, 'public.leaderboard_monthly', 'SELECT'), r || ' reads the monthly leaderboard';
    ASSERT NOT has_table_privilege(r, 'public.leaderboard_weekly', 'SELECT'), r || ' reads the weekly leaderboard';
    ASSERT NOT has_column_privilege(r, 'public.users', 'transaction_pin_hash', 'SELECT'), r || ' reads the PIN hash';
    ASSERT NOT has_column_privilege(r, 'public.users', 'transaction_pin_locked_until', 'SELECT'), r || ' reads the PIN lock';
    ASSERT NOT has_table_privilege(r, 'public.events', 'INSERT'), r || ' inserts events';
    ASSERT NOT has_table_privilege(r, 'public.events', 'DELETE'), r || ' deletes events';
    ASSERT NOT has_column_privilege(r, 'public.events', 'status', 'UPDATE'), r || ' sets event status';
    ASSERT NOT has_column_privilege(r, 'public.events', 'host_id', 'UPDATE'), r || ' moves an event';
    ASSERT NOT has_table_privilege(r, 'public.wallets', 'TRUNCATE'), r || ' can truncate wallets';
    ASSERT NOT has_table_privilege(r, 'public.transactions', 'TRUNCATE'), r || ' can truncate transactions';
  END LOOP;
  ASSERT has_column_privilege('authenticated', 'public.users', 'kyc_level', 'SELECT'), 'the app reads kyc_level';
  ASSERT has_column_privilege('authenticated', 'public.users', 'gender', 'UPDATE'), 'the app sets gender';
  ASSERT has_column_privilege('authenticated', 'public.events', 'cover_url', 'UPDATE'), 'hosts set the cover';
  ASSERT has_column_privilege('anon', 'public.events', 'event_code', 'SELECT'), 'the screen reads the event';
  ASSERT NOT has_column_privilege('anon', 'public.events', 'host_id', 'SELECT'), 'signed out reads the host id';
  ASSERT NOT has_column_privilege('anon', 'public.events', 'flag_reason', 'SELECT'), 'signed out reads flag fields';
END $$;

-- ── fixtures ────────────────────────────────────────────────────────────────────────────────
CREATE TEMP TABLE t (k text PRIMARY KEY, v uuid);
GRANT ALL ON t TO anon, authenticated, service_role;
DO $$
DECLARE host uuid; other uuid;
BEGIN
  host := pg_temp.mk_user('s106-host@test.local', 0);
  other := pg_temp.mk_user('s106-other@test.local', 0);
  INSERT INTO t VALUES
    ('host', host), ('other', other),
    ('guest', pg_temp.mk_user('s106-guest@test.local', 0)),
    ('outsider', pg_temp.mk_user('s106-outsider@test.local', 0)),
    ('support', pg_temp.mk_admin('s106-support@test.local', 'support')),
    ('super', pg_temp.mk_admin('s106-super@test.local', 'super_admin')),
    ('ev', pg_temp.mk_event(host, 'live', false)),
    ('ev_private', pg_temp.mk_event(host, 'live', true)),
    ('ev_ended', pg_temp.mk_event(host, 'ended', false)),
    ('ev_full', pg_temp.mk_event(host, 'live', false, 1));
  INSERT INTO public.event_participants (event_id, user_id, role)
  SELECT v, (SELECT v FROM t WHERE k = 'guest'), 'guest' FROM t WHERE k IN ('ev', 'ev_private', 'ev_full');
  PERFORM pg_temp.mk_giveaway(other, 'S106PUB', (SELECT v FROM t WHERE k = 'ev'));
  PERFORM pg_temp.mk_giveaway(other, 'S106HID', (SELECT v FROM t WHERE k = 'ev'), true);
  PERFORM pg_temp.mk_giveaway(other, 'S106PRV', (SELECT v FROM t WHERE k = 'ev_private'));
  PERFORM pg_temp.mk_giveaway(other, 'S106END', (SELECT v FROM t WHERE k = 'ev_ended'));
  PERFORM pg_temp.mk_giveaway(other, 'S106FUL', (SELECT v FROM t WHERE k = 'ev_full'));
  PERFORM pg_temp.mk_giveaway(other, 'S106SOLO', NULL);
END $$;

-- ── signed out ──────────────────────────────────────────────────────────────────────────────
DO $$
DECLARE ev uuid := (SELECT v FROM t WHERE k = 'ev'); n bigint;
BEGIN
  ASSERT pg_temp.run_as('anon', format('SELECT public.verify_transaction_pin_internal(%L, ''0000'')', (SELECT v FROM t WHERE k = 'host'))) LIKE '42501%', 'PIN oracle shut';
  ASSERT pg_temp.run_as('anon', format('SELECT public.create_notification(%L, ''x'', ''x'', ''x'', ''{}'')', (SELECT v FROM t WHERE k = 'host'))) LIKE '42501%', 'forged notification shut';
  ASSERT pg_temp.run_as('anon', 'SELECT public.refresh_leaderboards()') LIKE '42501%', 'refresh shut';
  ASSERT pg_temp.run_as('anon', 'SELECT count(*) FROM public.leaderboard_alltime') LIKE '42501%', 'leaderboard shut';
  ASSERT pg_temp.count_as('anon', 'SELECT count(*) FROM public.giveaways') = 0, 'no giveaway rows signed out';
  ASSERT pg_temp.count_as('anon', 'SELECT count(*) FROM public.spray_holds') = 0, 'no hold rows signed out';
  ASSERT pg_temp.count_as('anon', 'SELECT count(*) FROM storage.objects WHERE bucket_id = ''avatars''') = 0, 'avatars not listable';
  ASSERT pg_temp.run_as('anon', 'SELECT host_id FROM public.events') LIKE '42501%', 'no host id signed out';
  -- the screen still finds its event and its public giveaways (code included: the screen shows it)
  ASSERT pg_temp.count_as('anon', format('SELECT count(*) FROM (SELECT id, title, event_code, status, total_sprayed FROM public.events WHERE id = %L) s', ev)) = 1, 'screen reads its event';
  ASSERT pg_temp.count_as('anon', format('SELECT count(*) FROM public.get_event_screen_giveaways(%L) WHERE code = ''S106PUB''', ev)) = 1, 'screen shows the public giveaway';
  ASSERT pg_temp.count_as('anon', format('SELECT count(*) FROM public.get_event_screen_giveaways(%L) WHERE code = ''S106HID''', ev)) = 0, 'a private giveaway is never on the screen';
END $$;

-- ── signed in: a host ───────────────────────────────────────────────────────────────────────
SELECT pg_temp.auth_as((SELECT v FROM t WHERE k = 'host'));
DO $$
DECLARE ev uuid := (SELECT v FROM t WHERE k = 'ev'); ended uuid := (SELECT v FROM t WHERE k = 'ev_ended');
BEGIN
  ASSERT pg_temp.run_as('authenticated', format('UPDATE public.events SET status = ''live'', ended_at = NULL WHERE id = %L', ended)) LIKE '42501%', 'host cannot reopen';
  ASSERT pg_temp.run_as('authenticated', format('UPDATE public.events SET flagged = false WHERE id = %L', ev)) LIKE '42501%', 'host cannot unflag';
  ASSERT pg_temp.run_as('authenticated', format('UPDATE public.events SET total_sprayed = 999 WHERE id = %L', ev)) LIKE '42501%', 'host cannot forge totals';
  ASSERT pg_temp.run_as('authenticated', format('INSERT INTO public.events (host_id, title, type, event_code, status) VALUES (%L, ''x'', ''party'', ''S106XX'', ''live'')', (SELECT v FROM t WHERE k = 'host'))) LIKE '42501%', 'no direct insert';
  ASSERT pg_temp.run_as('authenticated', format('DELETE FROM public.events WHERE id = %L', ev)) LIKE '42501%', 'no direct delete';
  ASSERT pg_temp.run_as('authenticated', format('UPDATE public.events SET cover_url = ''https://x.test/c.jpg'' WHERE id = %L', ev)) IS NULL, 'host sets the cover';
  ASSERT (SELECT cover_url FROM public.events WHERE id = ev) = 'https://x.test/c.jpg', 'cover saved';

  ASSERT pg_temp.run_as('authenticated', 'SELECT transaction_pin_hash FROM public.users') LIKE '42501%', 'own PIN hash unreadable';
  ASSERT pg_temp.run_as('authenticated', 'SELECT * FROM public.users') LIKE '42501%', 'select * refused (it would include the PIN columns)';
  ASSERT pg_temp.count_as('authenticated', 'SELECT count(*) FROM (SELECT id, phone, email, username, full_name, avatar_url, avatar_data, gender, kyc_level, status FROM public.users WHERE auth_id = auth.uid()) s') = 1, 'the app''s profile read works';
  ASSERT pg_temp.run_as('authenticated', 'UPDATE public.users SET full_name = ''Sec Host'', gender = ''female'' WHERE auth_id = auth.uid()') IS NULL, 'the app''s profile save works';
  ASSERT pg_temp.run_as('authenticated', 'UPDATE public.users SET kyc_level = 2 WHERE auth_id = auth.uid()') LIKE '42501%', 'kyc_level still locked';
  ASSERT pg_temp.count_as('authenticated', 'SELECT count(*) FROM public.wallets')
         = (SELECT count(*) FROM public.wallets WHERE user_id = (SELECT v FROM t WHERE k = 'host')), 'own wallets only';
  ASSERT pg_temp.run_as('authenticated', 'SELECT public.has_transaction_pin()') IS NULL, 'has_transaction_pin works';
  ASSERT pg_temp.run_as('authenticated', format('INSERT INTO storage.objects (bucket_id, name, owner) VALUES (''avatars'', %L, auth.uid())', auth.uid()::text || '/x.bin')) LIKE '42501%', 'no client uploads to avatars';
END $$;

-- someone else cannot touch the host's cover
SELECT pg_temp.auth_as((SELECT v FROM t WHERE k = 'other'));
DO $$
BEGIN
  PERFORM pg_temp.run_as('authenticated', format('UPDATE public.events SET cover_url = ''https://x.test/evil.jpg'' WHERE id = %L', (SELECT v FROM t WHERE k = 'ev')));
  ASSERT (SELECT cover_url FROM public.events WHERE id = (SELECT v FROM t WHERE k = 'ev')) = 'https://x.test/c.jpg', 'only the host changes the cover';
END $$;

-- ── signed in: admins hold no direct table access ───────────────────────────────────────────
SELECT pg_temp.auth_as((SELECT v FROM t WHERE k = 'support'));
DO $$
BEGIN
  ASSERT pg_temp.count_as('authenticated', 'SELECT count(*) FROM (SELECT id FROM public.users) s') = 1, 'an admin reads only their own user row';
  ASSERT pg_temp.count_as('authenticated', 'SELECT count(*) FROM public.transactions') = 0, 'no direct transactions';
  ASSERT pg_temp.count_as('authenticated', 'SELECT count(*) FROM public.webhook_logs') = 0, 'no direct webhook logs';
  ASSERT pg_temp.run_as('authenticated', format('UPDATE public.events SET host_id = %L WHERE id = %L', (SELECT v FROM t WHERE k = 'support'), (SELECT v FROM t WHERE k = 'ev'))) LIKE '42501%', 'an admin cannot take an event';
  ASSERT pg_temp.count_as('authenticated', 'SELECT count(*) FROM public.admin_roles') = 1, 'still reads own role';
  ASSERT pg_temp.run_as('authenticated', 'SELECT public.set_psp_env(''sandbox'')') LIKE '%Super admin access required', 'support cannot switch the payment environment';
  ASSERT pg_temp.run_as('authenticated', 'SELECT public.set_disbursement_provider(''flutterwave'')') LIKE '%Super admin access required', 'support cannot switch the payout provider';
END $$;
SELECT pg_temp.auth_as((SELECT v FROM t WHERE k = 'super'));
DO $$
DECLARE env text := (SELECT psp_env FROM public.platform_settings WHERE id = 1);
BEGIN
  ASSERT pg_temp.run_as('authenticated', format('INSERT INTO public.admin_roles (user_id, role) VALUES (%L, ''finance'')', gen_random_uuid())) LIKE '42501%', 'no admin is added outside the admin function';
  ASSERT pg_temp.run_as('authenticated', format('SELECT public.set_psp_env(%L)', env)) IS NULL, 'a super admin still sets the environment';
  ASSERT EXISTS (SELECT 1 FROM public.admin_audit_log WHERE action = 'set_psp_env' AND admin_user_id = auth.uid()), 'and it is audited';
END $$;

-- ── giveaway claims (as the giveaway function calls it) ─────────────────────────────────────
CREATE FUNCTION pg_temp.claim(p_who text, p_code text) RETURNS text LANGUAGE sql AS $$
  SELECT pg_temp.run_as('service_role', format('SELECT public.redeem_giveaway_code(%L, %L)', (SELECT v FROM t WHERE k = p_who), p_code))
$$;
DO $$
DECLARE ev uuid := (SELECT v FROM t WHERE k = 'ev'); outsider uuid := (SELECT v FROM t WHERE k = 'outsider');
BEGIN
  -- a guest of the event claims
  ASSERT pg_temp.claim('guest', 'S106PUB') IS NULL, 'guest claims';
  -- not a guest yet, public live event with room: the claim joins them
  ASSERT NOT EXISTS (SELECT 1 FROM public.event_participants WHERE event_id = ev AND user_id = outsider), 'outsider starts outside';
  ASSERT pg_temp.claim('outsider', 'S106PUB') IS NULL, 'a scan at the party claims in one step';
  ASSERT EXISTS (SELECT 1 FROM public.event_participants WHERE event_id = ev AND user_id = outsider AND role = 'guest'), 'and joins the event';
  ASSERT (SELECT balance FROM public.wallets WHERE user_id = outsider AND currency = 'NGN') = 10000, 'credited once';
  ASSERT pg_temp.claim('outsider', 'S106PUB') LIKE '%already redeemed%', 'no second claim';
  -- the event's host (not the creator) claims without joining
  ASSERT pg_temp.claim('host', 'S106PUB') IS NULL, 'host claims';
  -- private, ended and full events: guests only
  ASSERT pg_temp.claim('outsider', 'S106PRV') LIKE '%Join the event to claim this giveaway', 'private event refused';
  ASSERT pg_temp.claim('guest', 'S106PRV') IS NULL, 'its guest claims';
  ASSERT pg_temp.claim('outsider', 'S106END') LIKE '%Join the event to claim this giveaway', 'ended event refused';
  ASSERT pg_temp.claim('outsider', 'S106FUL') LIKE '%Join the event to claim this giveaway', 'full event refused';
  ASSERT NOT EXISTS (SELECT 1 FROM public.event_participants WHERE user_id = outsider AND event_id <> ev), 'a refused claim joins nothing';
  ASSERT (SELECT balance FROM public.wallets WHERE user_id = outsider AND currency = 'NGN') = 10000, 'a refused claim credits nothing';
  -- a giveaway with no event is unchanged
  ASSERT pg_temp.claim('outsider', 'S106SOLO') IS NULL, 'standalone giveaway still open';
  -- the definer chain still notifies the creator after create_notification was closed
  ASSERT EXISTS (SELECT 1 FROM public.notifications WHERE type = 'giveaway_redeemed'
                 AND user_id IN (SELECT v FROM t WHERE k IN ('other', 'guest', 'outsider', 'host'))), 'the claim still notifies';
END $$;

-- ── the server keeps its paths ──────────────────────────────────────────────────────────────
DO $$
BEGIN
  ASSERT pg_temp.run_as('service_role', 'SELECT public.refresh_leaderboards()') IS NULL, 'cron refreshes leaderboards';
  ASSERT pg_temp.run_as('service_role', format('SELECT public.create_notification(%L, ''deposit_completed'', ''t'', ''b'', ''{}'')', (SELECT v FROM t WHERE k = 'host'))) IS NULL, 'server notifies';
  ASSERT pg_temp.count_as('service_role', 'SELECT count(*) FROM (SELECT transaction_pin_hash FROM public.users LIMIT 1) s') >= 0, 'server reads PIN columns';
  ASSERT pg_temp.run_as('service_role', format('UPDATE public.events SET status = ''ended'', ended_at = now() WHERE id = %L', (SELECT v FROM t WHERE k = 'ev_full'))) IS NULL, 'the events function still ends events';
END $$;

SELECT 'ALL 106 TESTS PASSED' AS result;
