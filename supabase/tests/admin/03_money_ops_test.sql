-- 096: outside-refund record on paid-but-failed bundle orders, per-currency stats, money overview.

CREATE FUNCTION pg_temp.err(q text) RETURNS text LANGUAGE plpgsql AS $$
BEGIN EXECUTE q; RETURN NULL; EXCEPTION WHEN OTHERS THEN RETURN SQLERRM; END $$;

CREATE TEMP TABLE fx AS
SELECT u.id AS user_id, u.auth_id,
       (SELECT id FROM public.wallets WHERE user_id = u.id AND currency = 'NGN') AS ngn_wallet,
       (SELECT id FROM public.wallets WHERE user_id = u.id AND currency = 'USDC') AS usdc_wallet
FROM public.users u WHERE u.id = '53f63182-22be-4f1f-aa78-c24d52ad4f3d';

CREATE TEMP TABLE s0 AS SELECT public.admin_dashboard_stats() AS s, public.admin_money_overview() AS o;

INSERT INTO public.bundle_orders (user_id, currency, bundles, amount, tx_ref, status, provider, provider_ref, failure_reason)
SELECT fx.user_id, v.cur::public.currency, 10, 5000, 'test-096-' || v.k, v.st, 'flutterwave', v.pref, 'test'
FROM fx CROSS JOIN (VALUES
  ('paidfail', 'NGN',  'failed',        'flw-1'),
  ('unpaid',   'NGN',  'failed',        NULL),
  ('credited', 'NGN',  'credited',      'flw-2'),
  ('usdcfail', 'USDC', 'failed',        'bc-1'),
  ('float',    'USDC', 'pending_float', 'bc-2')
) AS v(k, cur, st, pref);

INSERT INTO public.transactions (wallet_id, user_id, currency, type, amount, net_amount, status, provider, idempotency_key, description, metadata)
SELECT v.w, fx.user_id, v.cur::public.currency, v.t::public.transaction_type, v.amt, v.amt, v.st::public.transaction_status, 'internal', 'test-096-' || v.k, 'test 096', v.meta
FROM fx CROSS JOIN LATERAL (VALUES
  ('ngn-dep',  fx.ngn_wallet,  'NGN',  'deposit',    500,     'completed',  NULL::jsonb),
  ('usdc-dep', fx.usdc_wallet, 'USDC', 'deposit',    2000000, 'completed',  NULL::jsonb),
  ('review',   fx.ngn_wallet,  'NGN',  'withdrawal', -1,      'processing', '{"needs_review":true}'::jsonb)
) AS v(k, w, cur, t, amt, st, meta);
-- the open withdrawal needs its hold so the wallet constraints stay valid
UPDATE public.wallets SET balance = balance + 1, locked_balance = locked_balance + 1 WHERE id = (SELECT ngn_wallet FROM fx);

DO $$
DECLARE
  a uuid := (SELECT auth_id FROM fx);
  o_paid uuid := (SELECT id FROM public.bundle_orders WHERE tx_ref = 'test-096-paidfail');
  o_unpaid uuid := (SELECT id FROM public.bundle_orders WHERE tx_ref = 'test-096-unpaid');
  o_cred uuid := (SELECT id FROM public.bundle_orders WHERE tx_ref = 'test-096-credited');
  o_usdc uuid := (SELECT id FROM public.bundle_orders WHERE tx_ref = 'test-096-usdcfail');
  b jsonb := (SELECT s FROM s0); bo jsonb := (SELECT o FROM s0);
  s jsonb := public.admin_dashboard_stats(); o jsonb := public.admin_money_overview();
  q text := 'SELECT public.admin_record_bundle_refund(%L, %L, %L, %s, %L)';
  dep_before int; dep_after int;
BEGIN
  -- per-currency stats
  ASSERT (s->>'ngn_volume')::bigint - (b->>'ngn_volume')::bigint = 500, 'ngn volume delta';
  ASSERT (s->>'usdc_volume')::bigint - (b->>'usdc_volume')::bigint = 2000000, 'usdc volume delta';
  ASSERT (s->>'usdc_today_volume')::bigint - (b->>'usdc_today_volume')::bigint = 2000000, 'usdc today delta';
  ASSERT (s->>'total_volume') = (s->>'ngn_volume'), 'total_volume is NGN only';
  ASSERT (s->>'today_volume') = (s->>'ngn_today_volume'), 'today_volume is NGN only';

  -- overview by type
  SELECT COALESCE(max((e->>'count_today')::int), 0) INTO dep_before FROM jsonb_array_elements(bo->'by_type') e WHERE e->>'type' = 'deposit' AND e->>'currency' = 'NGN';
  SELECT COALESCE(max((e->>'count_today')::int), 0) INTO dep_after FROM jsonb_array_elements(o->'by_type') e WHERE e->>'type' = 'deposit' AND e->>'currency' = 'NGN';
  ASSERT dep_after - dep_before = 1, 'NGN deposit count_today delta';

  -- overview queue
  ASSERT (o->'queue'->>'orders_paid_failed')::int - (bo->'queue'->>'orders_paid_failed')::int = 1, 'one paid-failed NGN order (USDC excluded, unpaid excluded)';
  ASSERT (o->'queue'->>'orders_pending_float')::int - (bo->'queue'->>'orders_pending_float')::int = 1, 'one pending_float order';
  ASSERT (o->'queue'->>'payouts_needing_review')::int - (bo->'queue'->>'payouts_needing_review')::int = 1, 'one payout needing review';

  -- refund guards
  ASSERT pg_temp.err(format(q, gen_random_uuid(), a, 'R1', 5000, '')) = 'Order not found', 'missing';
  ASSERT pg_temp.err(format(q, o_cred, a, 'R1', 5000, '')) = 'Only failed NGN orders can be refunded', 'credited refused';
  ASSERT pg_temp.err(format(q, o_usdc, a, 'R1', 5000, '')) = 'Only failed NGN orders can be refunded', 'usdc refused';
  ASSERT pg_temp.err(format(q, o_unpaid, a, 'R1', 5000, '')) = 'This order has no recorded payment', 'unpaid refused';
  ASSERT pg_temp.err(format(q, o_paid, a, '  ', 5000, '')) = 'A refund reference is required', 'blank reference';
  ASSERT pg_temp.err(format(q, o_paid, a, 'R1', 0, '')) = 'Refund amount must be positive', 'zero amount';

  -- refund recorded
  PERFORM public.admin_record_bundle_refund(o_paid, a, 'GTB-REF-77', 5000, 'Refunded underpayment');
  ASSERT (SELECT refund_reference FROM public.bundle_orders WHERE id = o_paid) = 'GTB-REF-77', 'reference saved';
  ASSERT (SELECT refunded_at IS NOT NULL AND refunded_by = a FROM public.bundle_orders WHERE id = o_paid), 'who and when saved';
  ASSERT pg_temp.err(format(q, o_paid, a, 'R2', 5000, '')) = 'A refund is already recorded', 'second refund refused';
  ASSERT (SELECT count(*) FROM public.admin_audit_log WHERE action = 'record_bundle_refund' AND target_id = o_paid) = 1, 'audited';
  ASSERT (public.admin_money_overview()->'queue'->>'orders_paid_failed')::int = (bo->'queue'->>'orders_paid_failed')::int, 'refunded order leaves the queue';
END $$;

DO $$
DECLARE r text; f text;
BEGIN
  FOREACH r IN ARRAY ARRAY['anon', 'authenticated'] LOOP
    FOREACH f IN ARRAY ARRAY['public.admin_record_bundle_refund(uuid,uuid,text,bigint,text)', 'public.admin_money_overview()', 'public.admin_dashboard_stats(int)'] LOOP
      ASSERT NOT has_function_privilege(r, f::regprocedure, 'execute'), r || ' must not execute ' || f;
    END LOOP;
  END LOOP;
  ASSERT has_function_privilege('service_role', 'public.admin_record_bundle_refund(uuid,uuid,text,bigint,text)'::regprocedure, 'execute'), 'service_role refund';
  ASSERT has_function_privilege('service_role', 'public.admin_money_overview()'::regprocedure, 'execute'), 'service_role overview';
END $$;

SELECT 'money ops tests passed' AS result;
