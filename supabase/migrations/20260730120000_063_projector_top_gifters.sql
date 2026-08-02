-- Projector top sprayers: public live events + host on private events.

CREATE OR REPLACE FUNCTION public.get_event_top_gifters(
  p_event_id UUID,
  p_limit INT DEFAULT 3
)
RETURNS TABLE (
  sprayer_id UUID,
  sprayer_name TEXT,
  sprayer_username TEXT,
  sprayer_avatar_url TEXT,
  sprayer_avatar_data JSONB,
  total_amount BIGINT
)
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path = public
AS $$
  SELECT
    sr.sprayer_id,
    COALESCE(NULLIF(trim(u.full_name), ''), NULLIF(trim(u.username), ''), 'Guest') AS sprayer_name,
    u.username AS sprayer_username,
    u.avatar_url AS sprayer_avatar_url,
    COALESCE(u.avatar_data, '{}'::jsonb) AS sprayer_avatar_data,
    SUM(sr.amount)::BIGINT AS total_amount
  FROM public.spray_records sr
  JOIN public.events e ON e.id = sr.event_id
  JOIN public.users u ON u.id = sr.sprayer_id
  WHERE sr.event_id = p_event_id
    AND (
      (e.is_private = false AND e.status = 'live')
      OR e.host_id IN (SELECT id FROM public.users WHERE auth_id = auth.uid())
    )
  GROUP BY sr.sprayer_id, u.full_name, u.username, u.avatar_url, u.avatar_data
  ORDER BY total_amount DESC
  LIMIT LEAST(GREATEST(COALESCE(p_limit, 3), 1), 20);
$$;

GRANT EXECUTE ON FUNCTION public.get_event_top_gifters(UUID, INT) TO anon;
GRANT EXECUTE ON FUNCTION public.get_event_top_gifters(UUID, INT) TO authenticated;
