-- Migration 096: admin money operations — resolve stuck payouts, record outside refunds on
-- paid-but-failed bundle orders, per-currency dashboard stats, money overview. Every function is
-- service_role only and called only by the admin edge function (which enforces the role matrix).

-- ── Resolve a stuck payout by hand (finance), under the payout's row lock ──
CREATE OR REPLACE FUNCTION public.admin_resolve_payout(
  p_transaction_id uuid,
  p_outcome text,
  p_admin_auth_id uuid,
  p_reason text
)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_txn public.transactions%ROWTYPE;
  v_sale boolean;
  v_reason text := btrim(COALESCE(p_reason, ''));
  v_status text;
BEGIN
  SELECT * INTO v_txn FROM public.transactions WHERE id = p_transaction_id FOR UPDATE;
  IF NOT FOUND OR v_txn.type <> 'withdrawal' THEN
    RAISE EXCEPTION 'Payout not found';
  END IF;
  IF v_txn.status NOT IN ('pending', 'processing') THEN
    RAISE EXCEPTION 'Payout is already %', v_txn.status;
  END IF;
  IF p_outcome IS NULL OR p_outcome NOT IN ('paid', 'failed') THEN
    RAISE EXCEPTION 'Outcome must be paid or failed';
  END IF;
  IF v_reason = '' THEN
    RAISE EXCEPTION 'A reason is required';
  END IF;
  IF p_outcome = 'failed' AND v_txn.metadata->'last_provider_check'->>'status' = 'terminal_success' THEN
    RAISE EXCEPTION 'The provider reported this payout as paid';
  END IF;

  -- Same routing as finalizeRpcNames() in _shared/sell.ts.
  v_sale := COALESCE(v_txn.metadata->>'kind', '') LIKE 'bundle_sale%';
  IF p_outcome = 'paid' THEN
    IF v_sale THEN PERFORM public.complete_bundle_sale(p_transaction_id);
    ELSE PERFORM public.complete_withdrawal(p_transaction_id); END IF;
  ELSE
    IF v_sale THEN PERFORM public.fail_bundle_sale(p_transaction_id);
    ELSE PERFORM public.fail_withdrawal(p_transaction_id); END IF;
  END IF;

  UPDATE public.transactions
  SET metadata = (COALESCE(metadata, '{}'::jsonb) - 'needs_review')
        || jsonb_build_object('manual_resolution', jsonb_build_object(
             'outcome', p_outcome, 'reason', v_reason, 'by', p_admin_auth_id, 'at', now())),
      updated_at = now()
  WHERE id = p_transaction_id
  RETURNING status::text INTO v_status;

  PERFORM public.log_admin_action(p_admin_auth_id, 'resolve_payout', 'transaction', p_transaction_id,
    jsonb_build_object('outcome', p_outcome, 'reason', v_reason));

  RETURN jsonb_build_object('transaction_id', p_transaction_id, 'outcome', p_outcome, 'status', v_status);
END;
$$;

REVOKE ALL ON FUNCTION public.admin_resolve_payout(uuid, text, uuid, text) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.admin_resolve_payout(uuid, text, uuid, text) TO service_role;
