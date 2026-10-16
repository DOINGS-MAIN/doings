-- Migration 095: admin dashboard stats computed in SQL (replaces loading every user and completed
-- transaction into the admin edge function). Called only by the admin function (service_role).

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
           COALESCE(sum(abs(amount)), 0) AS volume,
           COALESCE(sum(abs(amount)) FILTER (WHERE created_at >= date_trunc('day', now() AT TIME ZONE 'UTC')), 0) AS today
    FROM public.transactions
    WHERE status = 'completed' AND amount > 0
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
    'total_volume', t.volume,
    'today_volume', t.today,
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
