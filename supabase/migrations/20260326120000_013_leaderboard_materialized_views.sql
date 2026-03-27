-- Migration 013: Leaderboard Materialized Views
-- ================================================

CREATE MATERIALIZED VIEW public.leaderboard_weekly AS
SELECT
  u.id AS user_id,
  u.full_name,
  u.username,
  u.avatar_url,
  u.avatar_data,
  COALESCE(SUM(CASE WHEN t.type = 'spray' THEN ABS(t.amount) ELSE 0 END), 0)::BIGINT AS spray_total,
  COALESCE(SUM(CASE WHEN t.type = 'giveaway' THEN ABS(t.amount) ELSE 0 END), 0)::BIGINT AS giveaway_total,
  COALESCE(SUM(ABS(t.amount)), 0)::BIGINT AS total_gifted,
  COUNT(DISTINCT sr.event_id)::INT AS events_attended,
  RANK() OVER (ORDER BY COALESCE(SUM(ABS(t.amount)), 0) DESC)::INT AS rank
FROM public.users u
LEFT JOIN public.transactions t
  ON t.user_id = u.id
 AND t.type IN ('spray', 'giveaway')
 AND t.status = 'completed'
 AND t.amount < 0
 AND t.created_at >= now() - INTERVAL '7 days'
LEFT JOIN public.spray_records sr
  ON sr.sprayer_id = u.id
 AND sr.sprayed_at >= now() - INTERVAL '7 days'
GROUP BY u.id, u.full_name, u.username, u.avatar_url, u.avatar_data
HAVING COALESCE(SUM(ABS(t.amount)), 0) > 0
ORDER BY total_gifted DESC
LIMIT 100;

CREATE UNIQUE INDEX idx_lb_weekly_user ON public.leaderboard_weekly(user_id);

CREATE MATERIALIZED VIEW public.leaderboard_monthly AS
SELECT
  u.id AS user_id,
  u.full_name,
  u.username,
  u.avatar_url,
  u.avatar_data,
  COALESCE(SUM(CASE WHEN t.type = 'spray' THEN ABS(t.amount) ELSE 0 END), 0)::BIGINT AS spray_total,
  COALESCE(SUM(CASE WHEN t.type = 'giveaway' THEN ABS(t.amount) ELSE 0 END), 0)::BIGINT AS giveaway_total,
  COALESCE(SUM(ABS(t.amount)), 0)::BIGINT AS total_gifted,
  COUNT(DISTINCT sr.event_id)::INT AS events_attended,
  RANK() OVER (ORDER BY COALESCE(SUM(ABS(t.amount)), 0) DESC)::INT AS rank
FROM public.users u
LEFT JOIN public.transactions t
  ON t.user_id = u.id
 AND t.type IN ('spray', 'giveaway')
 AND t.status = 'completed'
 AND t.amount < 0
 AND t.created_at >= now() - INTERVAL '30 days'
LEFT JOIN public.spray_records sr
  ON sr.sprayer_id = u.id
 AND sr.sprayed_at >= now() - INTERVAL '30 days'
GROUP BY u.id, u.full_name, u.username, u.avatar_url, u.avatar_data
HAVING COALESCE(SUM(ABS(t.amount)), 0) > 0
ORDER BY total_gifted DESC
LIMIT 100;

CREATE UNIQUE INDEX idx_lb_monthly_user ON public.leaderboard_monthly(user_id);

CREATE MATERIALIZED VIEW public.leaderboard_alltime AS
SELECT
  u.id AS user_id,
  u.full_name,
  u.username,
  u.avatar_url,
  u.avatar_data,
  COALESCE(SUM(CASE WHEN t.type = 'spray' THEN ABS(t.amount) ELSE 0 END), 0)::BIGINT AS spray_total,
  COALESCE(SUM(CASE WHEN t.type = 'giveaway' THEN ABS(t.amount) ELSE 0 END), 0)::BIGINT AS giveaway_total,
  COALESCE(SUM(ABS(t.amount)), 0)::BIGINT AS total_gifted,
  COUNT(DISTINCT sr.event_id)::INT AS events_attended,
  RANK() OVER (ORDER BY COALESCE(SUM(ABS(t.amount)), 0) DESC)::INT AS rank
FROM public.users u
LEFT JOIN public.transactions t
  ON t.user_id = u.id
 AND t.type IN ('spray', 'giveaway')
 AND t.status = 'completed'
 AND t.amount < 0
LEFT JOIN public.spray_records sr
  ON sr.sprayer_id = u.id
GROUP BY u.id, u.full_name, u.username, u.avatar_url, u.avatar_data
HAVING COALESCE(SUM(ABS(t.amount)), 0) > 0
ORDER BY total_gifted DESC
LIMIT 100;

CREATE UNIQUE INDEX idx_lb_alltime_user ON public.leaderboard_alltime(user_id);

CREATE OR REPLACE FUNCTION public.refresh_leaderboards()
RETURNS void AS $$
BEGIN
  REFRESH MATERIALIZED VIEW CONCURRENTLY public.leaderboard_weekly;
  REFRESH MATERIALIZED VIEW CONCURRENTLY public.leaderboard_monthly;
  REFRESH MATERIALIZED VIEW CONCURRENTLY public.leaderboard_alltime;
END;
$$ LANGUAGE plpgsql SECURITY DEFINER;
