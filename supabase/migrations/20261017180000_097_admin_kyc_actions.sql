-- Migration 097: compliance actions on KYC — revoke a verified record (drops the user to Level 1
-- unless another verified current Level 2 record remains) and reset the user's attempt limit.
-- Both are service_role only and called only by the admin edge function (role "kyc").

CREATE OR REPLACE FUNCTION public.admin_revoke_kyc(p_kyc_id uuid, p_admin_auth_id uuid, p_reason text)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_kyc public.kyc_verifications%ROWTYPE;
  v_reason text := btrim(COALESCE(p_reason, ''));
  v_level smallint;
BEGIN
  SELECT * INTO v_kyc FROM public.kyc_verifications WHERE id = p_kyc_id FOR UPDATE;
  IF NOT FOUND THEN RAISE EXCEPTION 'KYC record not found'; END IF;
  IF v_kyc.status <> 'verified' THEN RAISE EXCEPTION 'Only a verified KYC record can be revoked'; END IF;
  IF v_kyc.superseded_at IS NOT NULL THEN RAISE EXCEPTION 'This record was replaced by a newer one'; END IF;
  -- One revoke per user at a time, so two revokes can't each see the other's record as still verified.
  PERFORM 1 FROM public.users WHERE id = v_kyc.user_id FOR UPDATE;
  IF v_reason = '' THEN RAISE EXCEPTION 'A reason is required'; END IF;

  -- The status change fires tr_notify_kyc_status, which tells the user with this reason.
  UPDATE public.kyc_verifications
  SET status = 'rejected', rejection_reason = 'Verification revoked: ' || v_reason,
      reviewed_by = p_admin_auth_id, reviewed_at = now()
  WHERE id = p_kyc_id;

  -- update_user_kyc_level only ever raises the level, so lower it directly (as 086 does).
  IF v_kyc.level >= 2 AND NOT EXISTS (
    SELECT 1 FROM public.kyc_verifications k
    WHERE k.user_id = v_kyc.user_id AND k.status = 'verified' AND k.level >= 2 AND k.superseded_at IS NULL
  ) THEN
    UPDATE public.users SET kyc_level = 1, updated_at = now()
    WHERE id = v_kyc.user_id AND kyc_level >= 2;
  END IF;

  SELECT kyc_level INTO v_level FROM public.users WHERE id = v_kyc.user_id;
  PERFORM public.log_admin_action(p_admin_auth_id, 'revoke_kyc', 'kyc', p_kyc_id,
    jsonb_build_object('reason', v_reason, 'user_id', v_kyc.user_id, 'level', v_kyc.level, 'new_kyc_level', v_level));
  RETURN jsonb_build_object('kyc_id', p_kyc_id, 'user_id', v_kyc.user_id, 'kyc_level', v_level);
END;
$$;

CREATE OR REPLACE FUNCTION public.admin_reset_kyc_attempts(p_user_id uuid, p_admin_auth_id uuid)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_removed int;
BEGIN
  IF NOT EXISTS (SELECT 1 FROM public.users WHERE id = p_user_id) THEN RAISE EXCEPTION 'User not found'; END IF;
  -- Same key kyc-dojah-verify passes to consume_rate_limit.
  DELETE FROM public.rate_limit_hits WHERE key = 'kyc-l2:' || p_user_id::text;
  GET DIAGNOSTICS v_removed = ROW_COUNT;
  PERFORM public.log_admin_action(p_admin_auth_id, 'reset_kyc_attempts', 'user', p_user_id,
    jsonb_build_object('removed', v_removed));
  RETURN jsonb_build_object('user_id', p_user_id, 'removed', v_removed);
END;
$$;

REVOKE ALL ON FUNCTION public.admin_revoke_kyc(uuid, uuid, text) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.admin_revoke_kyc(uuid, uuid, text) TO service_role;
REVOKE ALL ON FUNCTION public.admin_reset_kyc_attempts(uuid, uuid) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.admin_reset_kyc_attempts(uuid, uuid) TO service_role;
