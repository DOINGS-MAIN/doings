-- 095: admin_dashboard_stats() computes the dashboard in SQL and matches direct counts;
-- only service_role may call it.

CREATE TEMP TABLE before_stats AS SELECT public.admin_dashboard_stats() AS s;

DO $$
DECLARE s jsonb := (SELECT s FROM before_stats);
BEGIN
  ASSERT (s->>'total_users')::bigint = (SELECT count(*) FROM public.users), 'total_users';
  ASSERT (s->>'active_users')::bigint = (SELECT count(*) FROM public.users WHERE status = 'active'), 'active_users';
  ASSERT (s->>'blocked_users')::bigint = (SELECT count(*) FROM public.users WHERE status IN ('suspended','banned')), 'blocked_users';
  -- Customer transactions only since 096: the treasury's bookkeeping legs are left out.
  ASSERT (s->>'total_transactions')::bigint = (SELECT count(*) FROM public.transactions WHERE status = 'completed' AND amount > 0 AND user_id <> '00000000-0000-4000-8000-000000000001'), 'total_transactions';
  -- total_volume is NGN only since 096 (USDC is reported separately as usdc_volume).
  ASSERT (s->>'total_volume')::bigint = (SELECT COALESCE(sum(abs(amount)),0) FROM public.transactions WHERE status = 'completed' AND amount > 0 AND currency = 'NGN' AND user_id <> '00000000-0000-4000-8000-000000000001'), 'total_volume';
  ASSERT (s->>'total_fee_revenue')::bigint = (public.get_fee_revenue_stats()->>'total_fee_kobo')::bigint, 'total_fee_revenue';
  ASSERT (s->>'total_events')::bigint = (SELECT count(*) FROM public.events), 'total_events';
  ASSERT (s->>'live_events')::bigint = (SELECT count(*) FROM public.events WHERE status = 'live'), 'live_events';
  ASSERT (s->>'flagged_transactions')::bigint = (SELECT count(*) FROM public.transactions WHERE flagged = true), 'flagged_transactions';
END $$;

-- Known rows: one completed deposit today (+1 txn, +12345 volume, today too), one completed deposit
-- two days ago (+1 txn, +100 total volume, not today), one flagged, one stuck withdrawal (1h old),
-- one fresh pending withdrawal (not stuck).
INSERT INTO public.transactions (wallet_id, user_id, currency, type, amount, net_amount, status, provider, idempotency_key, description, flagged, created_at)
SELECT w.id, w.user_id, 'NGN', v.type::public.transaction_type, v.amount, v.amount, v.status::public.transaction_status, 'internal',
       'test-095-' || v.k, 'test 095', v.flagged, now() - v.age
FROM public.wallets w
CROSS JOIN (VALUES
  ('a', 'deposit',    12345, 'completed', false, interval '0'),
  ('b', 'deposit',      100, 'completed', true,  interval '2 days'),
  ('c', 'withdrawal',  -500, 'pending',   false, interval '1 hour'),
  ('d', 'withdrawal',  -500, 'processing',false, interval '1 minute')
) AS v(k, type, amount, status, flagged, age)
WHERE w.user_id = '53f63182-22be-4f1f-aa78-c24d52ad4f3d' AND w.currency = 'NGN';

DO $$
DECLARE b jsonb := (SELECT s FROM before_stats); a jsonb := public.admin_dashboard_stats();
BEGIN
  ASSERT (SELECT count(*) FROM public.transactions WHERE idempotency_key LIKE 'test-095-%') = 4, 'seeded 4 rows (stand-in NGN wallet exists)';
  ASSERT (a->>'total_transactions')::bigint - (b->>'total_transactions')::bigint = 2, 'two completed positive';
  ASSERT (a->>'total_volume')::bigint - (b->>'total_volume')::bigint = 12445, 'total volume delta';
  ASSERT (a->>'today_volume')::bigint - (b->>'today_volume')::bigint = 12345, 'today volume delta';
  ASSERT (a->>'flagged_transactions')::bigint - (b->>'flagged_transactions')::bigint = 1, 'flagged delta';
  ASSERT (a->>'stuck_withdrawals')::bigint - (b->>'stuck_withdrawals')::bigint = 1, 'only the 1h-old withdrawal is stuck';
  ASSERT (public.admin_dashboard_stats(0)->>'stuck_withdrawals')::bigint - (b->>'stuck_withdrawals')::bigint >= 2, 'p_stuck_minutes=0 counts both';
END $$;

DO $$
DECLARE r text;
BEGIN
  FOREACH r IN ARRAY ARRAY['anon', 'authenticated'] LOOP
    EXECUTE format('SET LOCAL ROLE %I', r);
    BEGIN
      PERFORM public.admin_dashboard_stats();
      RAISE EXCEPTION 'expected refusal for %', r;
    EXCEPTION WHEN insufficient_privilege THEN NULL;
    END;
    RESET ROLE;
  END LOOP;
  ASSERT has_function_privilege('service_role', 'public.admin_dashboard_stats(int)'::regprocedure, 'execute'), 'service_role can execute';
END $$;

-- "Today" is the UTC day whatever the session time zone: a row 30 minutes before UTC midnight is
-- yesterday, even in Lagos (UTC+1) where it's already after local midnight.
SET LOCAL TIME ZONE 'Africa/Lagos';
CREATE TEMP TABLE before_tz AS SELECT public.admin_dashboard_stats() AS s;
INSERT INTO public.transactions (wallet_id, user_id, currency, type, amount, net_amount, status, provider, idempotency_key, description, created_at)
SELECT w.id, w.user_id, 'NGN', 'deposit', 777, 777, 'completed', 'internal', 'test-095-tz', 'test 095',
       date_trunc('day', now(), 'UTC') - interval '30 minutes'
FROM public.wallets w
WHERE w.user_id = '53f63182-22be-4f1f-aa78-c24d52ad4f3d' AND w.currency = 'NGN';
DO $$
DECLARE b jsonb := (SELECT s FROM before_tz); a jsonb := public.admin_dashboard_stats();
BEGIN
  ASSERT (a->>'total_volume')::bigint - (b->>'total_volume')::bigint = 777, 'tz row counts in total';
  ASSERT (a->>'today_volume')::bigint - (b->>'today_volume')::bigint = 0, 'tz row before UTC midnight is not today';
END $$;
RESET TIME ZONE;

-- Users and events: a suspended user and a live event move the counts.
CREATE TEMP TABLE before_ue AS SELECT public.admin_dashboard_stats() AS s;
INSERT INTO public.users (phone, email, full_name, status) VALUES ('+2340000095095', 'test095@doings.internal', 'Test 095', 'suspended');
INSERT INTO public.events (host_id, title, type, status) VALUES ('53f63182-22be-4f1f-aa78-c24d52ad4f3d', 'Test 095', 'other', 'live');
DO $$
DECLARE b jsonb := (SELECT s FROM before_ue); a jsonb := public.admin_dashboard_stats();
BEGIN
  ASSERT (a->>'total_users')::bigint - (b->>'total_users')::bigint = 1, 'total_users delta';
  ASSERT (a->>'blocked_users')::bigint - (b->>'blocked_users')::bigint = 1, 'blocked_users delta';
  ASSERT (a->>'active_users')::bigint - (b->>'active_users')::bigint = 0, 'active_users unchanged';
  ASSERT (a->>'total_events')::bigint - (b->>'total_events')::bigint = 1, 'total_events delta';
  ASSERT (a->>'live_events')::bigint - (b->>'live_events')::bigint = 1, 'live_events delta';
END $$;

DO $$
BEGIN
  ASSERT NOT has_function_privilege('authenticated', 'public.get_fee_revenue_stats()'::regprocedure, 'execute'), 'fee stats not callable by users';
  ASSERT has_function_privilege('service_role', 'public.get_fee_revenue_stats()'::regprocedure, 'execute'), 'service_role keeps fee stats';
END $$;

SELECT 'admin_dashboard_stats tests passed' AS result;
