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

-- A recorded outside refund is final: a later "payment found" must not also credit the bundles.
DO $$
DECLARE
  o_paid uuid := (SELECT id FROM public.bundle_orders WHERE tx_ref = 'test-096-paidfail');
  r jsonb; purchases_before int; purchases_after int;
BEGIN
  SELECT count(*) INTO purchases_before FROM public.transactions WHERE idempotency_key = 'bundle-order-' || o_paid::text;
  r := public.settle_ngn_bundle_order('test-096-paidfail', 5000, 'NGN', 'flw-1b');
  ASSERT r->>'status' = 'refunded', 'refunded order is not credited: ' || r::text;
  ASSERT (SELECT status FROM public.bundle_orders WHERE id = o_paid) = 'failed', 'order stays failed';
  ASSERT (SELECT credit_transaction_id IS NULL FROM public.bundle_orders WHERE id = o_paid), 'no credit transaction';
  SELECT count(*) INTO purchases_after FROM public.transactions WHERE idempotency_key = 'bundle-order-' || o_paid::text;
  ASSERT purchases_after = purchases_before, 'no purchase credit written';
END $$;

-- Refund cap, empty payment references, and the treasury's own bookkeeping legs.
INSERT INTO public.bundle_orders (user_id, currency, bundles, amount, tx_ref, status, provider, provider_ref, failure_reason)
SELECT user_id, 'NGN', 10, 5000, 'test-096-' || k, 'failed', 'flutterwave', pref, 'test'
FROM fx CROSS JOIN (VALUES ('cap', 'flw-3'), ('emptyref', '')) AS v(k, pref);
CREATE TEMP TABLE s1 AS SELECT public.admin_dashboard_stats() AS s, public.admin_money_overview() AS o;
INSERT INTO public.transactions (wallet_id, user_id, currency, type, amount, net_amount, status, provider, idempotency_key, description)
SELECT public.get_treasury_wallet_id('NGN'), '00000000-0000-4000-8000-000000000001', 'NGN', 'purchase', 4321, 4321, 'completed', 'internal', 'test-096-treasury-leg', 'test 096';

DO $$
DECLARE
  a uuid := (SELECT auth_id FROM fx);
  o_cap uuid := (SELECT id FROM public.bundle_orders WHERE tx_ref = 'test-096-cap');
  o_empty uuid := (SELECT id FROM public.bundle_orders WHERE tx_ref = 'test-096-emptyref');
  b jsonb := (SELECT s FROM s1); bo jsonb := (SELECT o FROM s1);
  s jsonb := public.admin_dashboard_stats(); o jsonb := public.admin_money_overview();
  q text := 'SELECT public.admin_record_bundle_refund(%L, %L, %L, %s, %L)';
  p_before int; p_after int;
BEGIN
  ASSERT pg_temp.err(format(q, o_cap, a, 'R9', 5001, '')) = 'Refund amount can''t be more than the order amount', 'refund capped at the order amount';
  ASSERT pg_temp.err(format(q, o_empty, a, 'R9', 5000, '')) = 'This order has no recorded payment', 'empty provider_ref is unpaid';
  ASSERT (s->>'ngn_volume') = (b->>'ngn_volume'), 'treasury legs are not customer volume';
  SELECT COALESCE(max((e->>'count_today')::int), 0) INTO p_before FROM jsonb_array_elements(bo->'by_type') e WHERE e->>'type' = 'purchase' AND e->>'currency' = 'NGN';
  SELECT COALESCE(max((e->>'count_today')::int), 0) INTO p_after FROM jsonb_array_elements(o->'by_type') e WHERE e->>'type' = 'purchase' AND e->>'currency' = 'NGN';
  ASSERT p_after = p_before, 'treasury legs are not in money flows';
  -- of the two new failed orders only 'cap' (a real payment ref) is waiting for a refund
  ASSERT (o->'queue'->>'orders_paid_failed')::int - (bo->'queue'->>'orders_paid_failed')::int = 0, 'counts were taken after both inserts';
  ASSERT (SELECT count(*) FROM public.bundle_orders WHERE tx_ref IN ('test-096-cap','test-096-emptyref')
          AND currency = 'NGN' AND status = 'failed' AND NULLIF(btrim(provider_ref), '') IS NOT NULL AND refunded_at IS NULL) = 1, 'oracle';
END $$;

DO $$
DECLARE before_n int; after_n int;
BEGIN
  -- the queue count must agree with the refund guard: an order with provider_ref '' is not "paid"
  before_n := (public.admin_money_overview()->'queue'->>'orders_paid_failed')::int;
  UPDATE public.bundle_orders SET provider_ref = '' WHERE tx_ref = 'test-096-cap';
  after_n := (public.admin_money_overview()->'queue'->>'orders_paid_failed')::int;
  ASSERT before_n - after_n = 1, 'empty provider_ref leaves the paid-failed queue';
END $$;

SELECT 'money ops tests passed' AS result;
