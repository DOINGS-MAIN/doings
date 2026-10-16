-- Security advisor fixes (093): nobody outside the server can read or change the audit log, the
-- transaction flags or reserved accounts, or forge audit entries; the legitimate paths still work.
-- Uses tests/ads/_setup.sql (mk_user, mk_admin, auth_as).

CREATE TEMP TABLE t (k text PRIMARY KEY, v uuid);
GRANT ALL ON t TO anon, authenticated, service_role;
DO $$
BEGIN
  INSERT INTO t VALUES ('guest', pg_temp.mk_user('sec-guest@test.local', 0)),
                       ('mod', pg_temp.mk_admin('sec-mod@test.local', 'moderation'));
END $$;

-- signed out and signed in: every direct read, write and the audit helper are refused
DO $$
DECLARE r text; stmt text;
BEGIN
  FOREACH r IN ARRAY ARRAY['anon', 'authenticated'] LOOP
    EXECUTE format('SET LOCAL ROLE %I', r);
    FOREACH stmt IN ARRAY ARRAY[
      'SELECT count(*) FROM public.admin_audit_log',
      'DELETE FROM public.admin_audit_log',
      'INSERT INTO public.admin_audit_log (admin_user_id, action, target_type) VALUES (gen_random_uuid(), ''forged'', ''x'')',
      'SELECT count(*) FROM public.transaction_flags',
      'UPDATE public.transaction_flags SET resolved = true',
      'SELECT count(*) FROM public.monnify_reserved_accounts',
      'UPDATE public.monnify_reserved_accounts SET account_number = ''0000000000''',
      'SELECT public.log_admin_action(gen_random_uuid(), ''forged'', ''user'')'
    ] LOOP
      BEGIN
        EXECUTE stmt;
        RAISE EXCEPTION 'expected refusal for % : %', r, stmt;
      EXCEPTION WHEN insufficient_privilege THEN NULL;
      END;
    END LOOP;
    RESET ROLE;
  END LOOP;
END $$;

-- the legitimate paths still write: a manager's SECURITY DEFINER RPC audits as the API role
SELECT pg_temp.auth_as((SELECT v FROM t WHERE k = 'mod'));
SET LOCAL ROLE authenticated;
DO $$
DECLARE a public.ads;
BEGIN
  a := public.admin_upsert_ad(NULL, 'Sec test', '00000000-0000-4000-8000-0000000000dd.jpg', NULL, NULL, 0, now(), NULL);
  INSERT INTO t VALUES ('ad', a.id);
END $$;
RESET ROLE;
DO $$
BEGIN
  ASSERT EXISTS (SELECT 1 FROM public.admin_audit_log WHERE action = 'ad_created' AND target_id = (SELECT v FROM t WHERE k = 'ad')),
    'definer write still audited';
END $$;

-- the server (service_role: admin edge function, cron) still reads and writes
SET LOCAL ROLE service_role;
DO $$
DECLARE v_id uuid;
BEGIN
  PERFORM count(*) FROM public.admin_audit_log;
  PERFORM count(*) FROM public.transaction_flags;
  PERFORM count(*) FROM public.monnify_reserved_accounts;
  v_id := public.log_admin_action((SELECT auth_id FROM public.users WHERE id = (SELECT v FROM t WHERE k = 'mod')), 'sec_test', 'user');
  ASSERT v_id IS NOT NULL, 'service role can log';
END $$;
RESET ROLE;

-- the view now runs as the caller (reserved_accounts RLS applies)
DO $$
BEGIN
  ASSERT (SELECT 'security_invoker=true' = ANY (reloptions) FROM pg_class WHERE oid = 'public.monnify_reserved_accounts'::regclass),
    'view is security_invoker';
  ASSERT (SELECT relrowsecurity FROM pg_class WHERE oid = 'public.admin_audit_log'::regclass), 'audit log RLS on';
  ASSERT (SELECT relrowsecurity FROM pg_class WHERE oid = 'public.transaction_flags'::regclass), 'flags RLS on';
END $$;

SELECT 'security advisor tests passed' AS result;
