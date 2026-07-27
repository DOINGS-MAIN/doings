-- Real spray feed for event hosts + sprayers (replaces client mock data).

CREATE POLICY "Hosts can view sprays on their events"
  ON public.spray_records FOR SELECT TO authenticated
  USING (
    EXISTS (
      SELECT 1 FROM public.events e
      WHERE e.id = spray_records.event_id
        AND e.host_id IN (SELECT id FROM public.users WHERE auth_id = auth.uid())
    )
  );

CREATE POLICY "Sprayers can view own sprays"
  ON public.spray_records FOR SELECT TO authenticated
  USING (
    sprayer_id IN (SELECT id FROM public.users WHERE auth_id = auth.uid())
  );

CREATE OR REPLACE FUNCTION public.get_event_spray_feed(
  p_event_id UUID,
  p_limit INT DEFAULT 25
)
RETURNS TABLE (
  id UUID,
  amount BIGINT,
  denomination INT,
  sprayed_at TIMESTAMPTZ,
  sprayer_name TEXT,
  sprayer_username TEXT,
  sprayer_avatar_url TEXT
)
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path = public
AS $$
  SELECT
    sr.id,
    sr.amount,
    sr.denomination,
    sr.sprayed_at,
    COALESCE(NULLIF(trim(u.full_name), ''), NULLIF(trim(u.username), ''), 'Guest') AS sprayer_name,
    u.username AS sprayer_username,
    u.avatar_url AS sprayer_avatar_url
  FROM public.spray_records sr
  JOIN public.events e ON e.id = sr.event_id
  JOIN public.users u ON u.id = sr.sprayer_id
  WHERE sr.event_id = p_event_id
    AND (
      e.host_id IN (SELECT id FROM public.users WHERE auth_id = auth.uid())
      OR sr.sprayer_id IN (SELECT id FROM public.users WHERE auth_id = auth.uid())
    )
  ORDER BY sr.sprayed_at DESC
  LIMIT LEAST(GREATEST(COALESCE(p_limit, 25), 1), 100);
$$;

CREATE OR REPLACE FUNCTION public.get_event_top_gifters(
  p_event_id UUID,
  p_limit INT DEFAULT 3
)
RETURNS TABLE (
  sprayer_id UUID,
  sprayer_name TEXT,
  sprayer_username TEXT,
  sprayer_avatar_url TEXT,
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
    SUM(sr.amount)::BIGINT AS total_amount
  FROM public.spray_records sr
  JOIN public.events e ON e.id = sr.event_id
  JOIN public.users u ON u.id = sr.sprayer_id
  WHERE sr.event_id = p_event_id
    AND (
      e.host_id IN (SELECT id FROM public.users WHERE auth_id = auth.uid())
      OR sr.sprayer_id IN (SELECT id FROM public.users WHERE auth_id = auth.uid())
    )
  GROUP BY sr.sprayer_id, u.full_name, u.username, u.avatar_url
  ORDER BY total_amount DESC
  LIMIT LEAST(GREATEST(COALESCE(p_limit, 3), 1), 20);
$$;

GRANT EXECUTE ON FUNCTION public.get_event_spray_feed(UUID, INT) TO authenticated;
GRANT EXECUTE ON FUNCTION public.get_event_top_gifters(UUID, INT) TO authenticated;

-- Realtime for host event screen (totals + live spray feed).
DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_publication_tables
    WHERE pubname = 'supabase_realtime' AND schemaname = 'public' AND tablename = 'events'
  ) THEN
    ALTER PUBLICATION supabase_realtime ADD TABLE public.events;
  END IF;

  IF NOT EXISTS (
    SELECT 1 FROM pg_publication_tables
    WHERE pubname = 'supabase_realtime' AND schemaname = 'public' AND tablename = 'spray_records'
  ) THEN
    ALTER PUBLICATION supabase_realtime ADD TABLE public.spray_records;
  END IF;
END $$;
