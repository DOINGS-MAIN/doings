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

-- ── Outside refunds on paid-but-failed NGN bundle orders (no wallet change) ──
ALTER TABLE public.bundle_orders
  ADD COLUMN IF NOT EXISTS refund_reference text,
  ADD COLUMN IF NOT EXISTS refund_amount_kobo bigint,
  ADD COLUMN IF NOT EXISTS refund_note text,
  ADD COLUMN IF NOT EXISTS refunded_at timestamptz,
  ADD COLUMN IF NOT EXISTS refunded_by uuid REFERENCES auth.users(id);

CREATE OR REPLACE FUNCTION public.admin_record_bundle_refund(
  p_order_id uuid,
  p_admin_auth_id uuid,
  p_reference text,
  p_amount_kobo bigint,
  p_note text
)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_order public.bundle_orders%ROWTYPE;
  v_ref text := btrim(COALESCE(p_reference, ''));
BEGIN
  SELECT * INTO v_order FROM public.bundle_orders WHERE id = p_order_id FOR UPDATE;
  IF NOT FOUND THEN RAISE EXCEPTION 'Order not found'; END IF;
  IF v_order.currency <> 'NGN' OR v_order.status <> 'failed' THEN
    RAISE EXCEPTION 'Only failed NGN orders can be refunded';
  END IF;
  IF v_order.provider_ref IS NULL OR btrim(v_order.provider_ref) = '' THEN
    RAISE EXCEPTION 'This order has no recorded payment';
  END IF;
  IF v_order.refunded_at IS NOT NULL THEN RAISE EXCEPTION 'A refund is already recorded'; END IF;
  IF v_ref = '' THEN RAISE EXCEPTION 'A refund reference is required'; END IF;
  IF p_amount_kobo IS NULL OR p_amount_kobo <= 0 THEN RAISE EXCEPTION 'Refund amount must be positive'; END IF;
  IF p_amount_kobo > v_order.amount THEN RAISE EXCEPTION 'Refund amount can''t be more than the order amount'; END IF;

  UPDATE public.bundle_orders
  SET refund_reference = v_ref, refund_amount_kobo = p_amount_kobo, refund_note = NULLIF(btrim(COALESCE(p_note, '')), ''),
      refunded_at = now(), refunded_by = p_admin_auth_id, updated_at = now()
  WHERE id = p_order_id;

  PERFORM public.log_admin_action(p_admin_auth_id, 'record_bundle_refund', 'bundle_order', p_order_id,
    jsonb_build_object('reference', v_ref, 'amount_kobo', p_amount_kobo));
  RETURN jsonb_build_object('order_id', p_order_id);
END;
$$;

REVOKE ALL ON FUNCTION public.admin_record_bundle_refund(uuid, uuid, text, bigint, text) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.admin_record_bundle_refund(uuid, uuid, text, bigint, text) TO service_role;

-- ── Dashboard stats with volume per currency (total_volume / today_volume are NGN only) ──
CREATE OR REPLACE FUNCTION public.admin_dashboard_stats(p_stuck_minutes int DEFAULT 15)
RETURNS jsonb
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path = public
AS $$
  WITH u AS (
    SELECT count(*) AS total,
           count(*) FILTER (WHERE status = 'active') AS active,
           count(*) FILTER (WHERE status IN ('suspended', 'banned')) AS blocked
    FROM public.users
  ),
  t AS (
    SELECT count(*) AS total,
           COALESCE(sum(abs(amount)) FILTER (WHERE currency = 'NGN'), 0) AS ngn,
           COALESCE(sum(abs(amount)) FILTER (WHERE currency = 'NGN' AND created_at >= date_trunc('day', now(), 'UTC')), 0) AS ngn_today,
           COALESCE(sum(abs(amount)) FILTER (WHERE currency = 'USDC'), 0) AS usdc,
           COALESCE(sum(abs(amount)) FILTER (WHERE currency = 'USDC' AND created_at >= date_trunc('day', now(), 'UTC')), 0) AS usdc_today
    FROM public.transactions
    -- The treasury's own legs (e.g. a USDC sale's NGN-in credit) are bookkeeping, not customer volume.
    WHERE status = 'completed' AND amount > 0 AND user_id <> '00000000-0000-4000-8000-000000000001'
  ),
  e AS (
    SELECT count(*) AS total, count(*) FILTER (WHERE status = 'live') AS live
    FROM public.events
  ),
  fees AS (SELECT public.get_fee_revenue_stats() AS f)
  SELECT jsonb_build_object(
    'total_users', u.total,
    'active_users', u.active,
    'blocked_users', u.blocked,
    'total_transactions', t.total,
    'total_volume', t.ngn,
    'today_volume', t.ngn_today,
    'ngn_volume', t.ngn,
    'ngn_today_volume', t.ngn_today,
    'usdc_volume', t.usdc,
    'usdc_today_volume', t.usdc_today,
    'total_fee_revenue', COALESCE((fees.f->>'total_fee_kobo')::bigint, 0),
    'today_fee_revenue', COALESCE((fees.f->>'today_fee_kobo')::bigint, 0),
    'total_events', e.total,
    'live_events', e.live,
    'flagged_transactions', (SELECT count(*) FROM public.transactions WHERE flagged = true),
    'stuck_withdrawals', (
      SELECT count(*) FROM public.transactions
      WHERE type = 'withdrawal' AND status IN ('pending', 'processing')
        AND created_at < now() - make_interval(mins => p_stuck_minutes)
    )
  )
  FROM u, t, e, fees;
$$;

REVOKE ALL ON FUNCTION public.admin_dashboard_stats(int) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.admin_dashboard_stats(int) TO service_role;

-- ── Money overview: completed flows by type and currency, and the money queues ──
CREATE OR REPLACE FUNCTION public.admin_money_overview()
RETURNS jsonb
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path = public
AS $$
  WITH r AS (
    SELECT t.type::text AS type, t.currency::text AS currency,
           count(*) FILTER (WHERE t.created_at >= date_trunc('day', now(), 'UTC')) AS count_today,
           COALESCE(sum(abs(t.amount)) FILTER (WHERE t.created_at >= date_trunc('day', now(), 'UTC')), 0) AS amount_today,
           count(*) AS count_7d,
           COALESCE(sum(abs(t.amount)), 0) AS amount_7d
    FROM public.transactions t
    WHERE t.status = 'completed' AND t.created_at >= now() - interval '7 days'
      AND t.user_id <> '00000000-0000-4000-8000-000000000001'
    GROUP BY 1, 2
  )
  SELECT jsonb_build_object(
    'by_type', COALESCE((SELECT jsonb_agg(to_jsonb(r) ORDER BY r.type, r.currency) FROM r), '[]'::jsonb),
    'queue', jsonb_build_object(
      'payouts_needing_review', (
        SELECT count(*) FROM public.transactions
        WHERE type = 'withdrawal' AND status IN ('pending', 'processing') AND metadata->>'needs_review' = 'true'),
      'orders_paid_failed', (
        SELECT count(*) FROM public.bundle_orders
        WHERE currency = 'NGN' AND status = 'failed' AND NULLIF(btrim(provider_ref), '') IS NOT NULL AND refunded_at IS NULL),
      'orders_pending_float', (SELECT count(*) FROM public.bundle_orders WHERE status = 'pending_float')
    )
  );
$$;

REVOKE ALL ON FUNCTION public.admin_money_overview() FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.admin_money_overview() TO service_role;

-- ── Settling an NGN order: a recorded outside refund is final (078's definition otherwise unchanged) ──
CREATE OR REPLACE FUNCTION public.settle_ngn_bundle_order(
  p_tx_ref TEXT,
  p_paid_kobo BIGINT,
  p_currency TEXT,
  p_provider_ref TEXT
)
RETURNS JSONB
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_order public.bundle_orders%ROWTYPE;
  v_price BIGINT;
  v_wallet UUID;
  v_txn UUID;
BEGIN
  SELECT * INTO v_order FROM public.bundle_orders WHERE tx_ref = p_tx_ref FOR UPDATE;
  IF NOT FOUND THEN
    RAISE EXCEPTION 'Bundle order not found: %', p_tx_ref;
  END IF;
  IF v_order.status = 'credited' THEN
    RETURN jsonb_build_object('order_id', v_order.id, 'status', 'credited', 'already', true,
      'bundles', v_order.bundles);
  END IF;
  IF v_order.currency <> 'NGN' THEN
    RAISE EXCEPTION 'Not an NGN bundle order';
  END IF;
  -- An admin recorded that the person was refunded outside the app: never credit bundles as well.
  IF v_order.refunded_at IS NOT NULL THEN
    UPDATE public.bundle_orders
      SET failure_reason = left(COALESCE(failure_reason, '') || format(' | Payment %s seen after refund %s', p_provider_ref, v_order.refund_reference), 1000),
          updated_at = now()
      WHERE id = v_order.id;
    RETURN jsonb_build_object('order_id', v_order.id, 'status', 'refunded');
  END IF;
  IF upper(COALESCE(p_currency, '')) <> 'NGN' OR COALESCE(p_paid_kobo, 0) < v_order.amount THEN
    UPDATE public.bundle_orders
      SET status = 'failed', provider_ref = p_provider_ref,
          failure_reason = format('Paid %s %s, expected %s NGN kobo', p_paid_kobo, p_currency, v_order.amount),
          updated_at = now()
      WHERE id = v_order.id;
    RETURN jsonb_build_object('order_id', v_order.id, 'status', 'failed');
  END IF;

  SELECT bundle_price_kobo INTO v_price FROM public.platform_settings LIMIT 1;
  SELECT id INTO v_wallet FROM public.wallets WHERE user_id = v_order.user_id AND currency = 'NGN';
  IF v_wallet IS NULL THEN
    RAISE EXCEPTION 'NGN wallet not found for user %', v_order.user_id;
  END IF;

  v_txn := public.credit_wallet(
    v_wallet, v_order.user_id, v_order.bundles * v_price, 0, 'purchase',
    format('Bought %s bundles', v_order.bundles), 'flutterwave', p_provider_ref,
    'bundle-order-' || v_order.id::text,
    jsonb_build_object('bundle_order_id', v_order.id, 'bundles', v_order.bundles,
      'paid_kobo', p_paid_kobo, 'fee_kobo', v_order.fee_kobo)
  );

  UPDATE public.bundle_orders
    SET status = 'credited', provider_ref = p_provider_ref, wallet_id = v_wallet,
        credit_transaction_id = v_txn, failure_reason = NULL, updated_at = now()
    WHERE id = v_order.id;
  RETURN jsonb_build_object('order_id', v_order.id, 'status', 'credited', 'bundles', v_order.bundles);
END;
$$;

REVOKE ALL ON FUNCTION public.settle_ngn_bundle_order(TEXT, BIGINT, TEXT, TEXT) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.settle_ngn_bundle_order(TEXT, BIGINT, TEXT, TEXT) TO service_role;
