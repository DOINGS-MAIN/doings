-- 097: compliance can revoke a verified KYC record (user drops to Level 1 unless another verified
-- current Level 2 record remains) and reset a user's KYC attempt limit; service_role only.

CREATE FUNCTION pg_temp.err(q text) RETURNS text LANGUAGE plpgsql AS $$
BEGIN EXECUTE q; RETURN NULL; EXCEPTION WHEN OTHERS THEN RETURN SQLERRM; END $$;

CREATE TEMP TABLE fx AS SELECT id AS user_id, auth_id FROM public.users WHERE id = '53f63182-22be-4f1f-aa78-c24d52ad4f3d';

-- Two verified Level 2 records (the trigger raises the user to Level 2) and one pending record.
INSERT INTO public.kyc_verifications (user_id, level, status, provider, bvn_hmac, bvn_last_four, verification_method, verified_at)
SELECT user_id, 2, v.st::public.kyc_status, 'dojah', v.h, '1234', 'bvn_selfie', CASE WHEN v.st = 'verified' THEN now() END
FROM fx CROSS JOIN (VALUES ('verified', 'test-097-a'), ('verified', 'test-097-b'), ('pending', 'test-097-c')) AS v(st, h);

-- Attempt-limit hits: two for this user, one for another user, one unrelated key.
INSERT INTO public.rate_limit_hits (key) SELECT 'kyc-l2:' || user_id FROM fx;
INSERT INTO public.rate_limit_hits (key) SELECT 'kyc-l2:' || user_id FROM fx;
INSERT INTO public.rate_limit_hits (key) VALUES ('kyc-l2:11111111-1111-4111-8111-111111111111'), ('pin:' || '53f63182-22be-4f1f-aa78-c24d52ad4f3d');

DO $$
DECLARE
  a uuid := (SELECT auth_id FROM fx);
  u uuid := (SELECT user_id FROM fx);
  k_a uuid := (SELECT id FROM public.kyc_verifications WHERE bvn_hmac = 'test-097-a');
  k_b uuid := (SELECT id FROM public.kyc_verifications WHERE bvn_hmac = 'test-097-b');
  k_c uuid := (SELECT id FROM public.kyc_verifications WHERE bvn_hmac = 'test-097-c');
  q text := 'SELECT public.admin_revoke_kyc(%L, %L, %L)';
  r jsonb;
BEGIN
  ASSERT (SELECT kyc_level FROM public.users WHERE id = u) = 2, 'seed raised the user to Level 2';

  -- guards
  ASSERT pg_temp.err(format(q, gen_random_uuid(), a, 'x')) = 'KYC record not found', 'missing';
  ASSERT pg_temp.err(format(q, k_c, a, 'x')) = 'Only a verified KYC record can be revoked', 'pending refused';
  ASSERT pg_temp.err(format(q, k_a, a, '  ')) = 'A reason is required', 'blank reason';

  -- revoking one of two verified Level 2 records keeps Level 2
  r := public.admin_revoke_kyc(k_a, a, 'Selfie was a photo of a screen');
  ASSERT (r->>'kyc_level')::int = 2, 'another verified L2 remains → still Level 2';
  ASSERT (SELECT status FROM public.kyc_verifications WHERE id = k_a) = 'rejected', 'record rejected';
  ASSERT (SELECT rejection_reason FROM public.kyc_verifications WHERE id = k_a) = 'Verification revoked: Selfie was a photo of a screen', 'reason saved';
  ASSERT (SELECT reviewed_by FROM public.kyc_verifications WHERE id = k_a) = a, 'reviewer saved';
  ASSERT EXISTS (SELECT 1 FROM public.notifications WHERE user_id = u AND type = 'kyc_rejected'
                 AND body LIKE '%Verification revoked: Selfie was a photo of a screen%'), 'user notified with the reason';

  -- revoking the last one drops the user to Level 1
  r := public.admin_revoke_kyc(k_b, a, 'Wrong person');
  ASSERT (r->>'kyc_level')::int = 1, 'last verified L2 revoked → Level 1';
  ASSERT (SELECT kyc_level FROM public.users WHERE id = u) = 1, 'user row at Level 1';
  ASSERT pg_temp.err(format(q, k_b, a, 'again')) = 'Only a verified KYC record can be revoked', 'second revoke refused';
  ASSERT (SELECT count(*) FROM public.admin_audit_log WHERE action = 'revoke_kyc' AND target_id IN (k_a, k_b)) = 2, 'audited';

  -- reset clears only this user's kyc-l2 hits
  ASSERT pg_temp.err(format('SELECT public.admin_reset_kyc_attempts(%L, %L)', gen_random_uuid(), a)) = 'User not found', 'unknown user';
  r := public.admin_reset_kyc_attempts(u, a);
  ASSERT (r->>'removed')::int = 2, 'two hits removed';
  ASSERT NOT EXISTS (SELECT 1 FROM public.rate_limit_hits WHERE key = 'kyc-l2:' || u), 'user hits gone';
  ASSERT EXISTS (SELECT 1 FROM public.rate_limit_hits WHERE key = 'kyc-l2:11111111-1111-4111-8111-111111111111'), 'other user kept';
  ASSERT EXISTS (SELECT 1 FROM public.rate_limit_hits WHERE key = 'pin:' || u), 'other limiter kept';
  ASSERT (SELECT count(*) FROM public.admin_audit_log WHERE action = 'reset_kyc_attempts' AND target_id = u) = 1, 'reset audited';
END $$;

DO $$
DECLARE r text; f text;
BEGIN
  FOREACH r IN ARRAY ARRAY['anon', 'authenticated'] LOOP
    FOREACH f IN ARRAY ARRAY['public.admin_revoke_kyc(uuid,uuid,text)', 'public.admin_reset_kyc_attempts(uuid,uuid)'] LOOP
      ASSERT NOT has_function_privilege(r, f::regprocedure, 'execute'), r || ' must not execute ' || f;
    END LOOP;
  END LOOP;
  ASSERT has_function_privilege('service_role', 'public.admin_revoke_kyc(uuid,uuid,text)'::regprocedure, 'execute'), 'service_role revoke';
  ASSERT has_function_privilege('service_role', 'public.admin_reset_kyc_attempts(uuid,uuid)'::regprocedure, 'execute'), 'service_role reset';
END $$;

SELECT 'kyc actions tests passed' AS result;
