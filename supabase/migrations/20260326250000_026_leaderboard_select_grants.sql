-- Allow authenticated clients to read leaderboard materialized views (PostgREST).
GRANT SELECT ON public.leaderboard_weekly TO authenticated;
GRANT SELECT ON public.leaderboard_monthly TO authenticated;
GRANT SELECT ON public.leaderboard_alltime TO authenticated;
