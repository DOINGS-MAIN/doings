-- 120: an audit row written from a signed-in browser call gets the caller's IP; nothing else changes.
-- Run as: BEGIN; migration 120; tests/ads/_setup.sql; this file; ROLLBACK.

CREATE FUNCTION pg_temp.audit_ip(p_admin uuid, p_as_browser boolean, p_headers text, p_given inet) RETURNS inet
LANGUAGE plpgsql AS $$
DECLARE v_auth uuid := (SELECT auth_id FROM public.users WHERE id = p_admin); v_ip inet;
BEGIN
  IF p_as_browser THEN PERFORM pg_temp.auth_as(p_admin);
  ELSE PERFORM set_config('request.jwt.claims', '{"role":"service_role"}', true);
  END IF;
  PERFORM set_config('request.headers', p_headers, true);
  INSERT INTO public.admin_audit_log (admin_user_id, action, target_type, ip_address)
    VALUES (v_auth, 'sec120_test', 'test', p_given) RETURNING ip_address INTO v_ip;
  RETURN v_ip;
END $$;

DO $$
DECLARE admin uuid := pg_temp.mk_admin('s120-admin@test.local', 'super_admin');
BEGIN
  ASSERT pg_temp.audit_ip(admin, true, '{"cf-connecting-ip":"105.112.1.2","x-forwarded-for":"9.9.9.9, 10.0.0.1"}', NULL) = '105.112.1.2'::inet,
    'a browser call gets the edge network''s address';
  ASSERT pg_temp.audit_ip(admin, true, '{"x-forwarded-for":"105.112.3.4, 10.0.0.1"}', NULL) = '105.112.3.4'::inet,
    'falls back to the first forwarded address';
  ASSERT pg_temp.audit_ip(admin, true, '{"cf-connecting-ip":"not an address","x-forwarded-for":"105.112.5.6"}', NULL) = '105.112.5.6'::inet,
    'a header that is not an address is skipped';
  ASSERT pg_temp.audit_ip(admin, true, '{"x-forwarded-for":"<script>"}', NULL) IS NULL,
    'nothing usable: the row is still written, with no address';
  ASSERT pg_temp.audit_ip(admin, true, 'this is not json', NULL) IS NULL,
    'broken headers never stop the audit row';
  ASSERT pg_temp.audit_ip(admin, true, '', NULL) IS NULL, 'no headers at all: still written';
  ASSERT pg_temp.audit_ip(admin, true, '{"cf-connecting-ip":"105.112.1.2"}', '41.0.0.7') = '41.0.0.7'::inet,
    'an address the writer gave is kept';
  ASSERT pg_temp.audit_ip(admin, false, '{"cf-connecting-ip":"3.3.3.3"}', NULL) IS NULL,
    'the edge function''s own rows are not given its server''s address';
END $$;

SELECT 'PASS 17_audit_ip_for_browser_calls' AS result;
