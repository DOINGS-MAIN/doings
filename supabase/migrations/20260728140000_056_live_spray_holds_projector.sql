-- Live spray preview on projector: pending holds visible while guest is spraying.

ALTER TABLE public.spray_holds ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS "Hosts can view spray holds on their events" ON public.spray_holds;
CREATE POLICY "Hosts can view spray holds on their events"
  ON public.spray_holds FOR SELECT TO authenticated
  USING (
    EXISTS (
      SELECT 1 FROM public.events e
      WHERE e.id = spray_holds.event_id
        AND e.host_id IN (SELECT id FROM public.users WHERE auth_id = auth.uid())
    )
  );

DROP POLICY IF EXISTS "Sprayers can view own spray holds" ON public.spray_holds;
CREATE POLICY "Sprayers can view own spray holds"
  ON public.spray_holds FOR SELECT TO authenticated
  USING (
    sprayer_id IN (SELECT id FROM public.users WHERE auth_id = auth.uid())
  );

CREATE OR REPLACE FUNCTION public.get_event_live_spray_holds(p_event_id UUID)
RETURNS TABLE (
  hold_id UUID,
  planned_amount BIGINT,
  denomination INT,
  created_at TIMESTAMPTZ,
  sprayer_name TEXT,
  sprayer_username TEXT,
  sprayer_avatar_url TEXT,
  sprayer_avatar_data JSONB
)
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path = public
AS $$
  SELECT
    sh.id AS hold_id,
    sh.planned_amount_kobo AS planned_amount,
    sh.denomination,
    sh.created_at,
    COALESCE(NULLIF(trim(u.full_name), ''), NULLIF(trim(u.username), ''), 'Guest') AS sprayer_name,
    u.username AS sprayer_username,
    u.avatar_url AS sprayer_avatar_url,
    COALESCE(u.avatar_data, '{}'::jsonb) AS sprayer_avatar_data
  FROM public.spray_holds sh
  JOIN public.events e ON e.id = sh.event_id
  JOIN public.users u ON u.id = sh.sprayer_id
  WHERE sh.event_id = p_event_id
    AND sh.status = 'pending'
    AND (
      e.host_id IN (SELECT id FROM public.users WHERE auth_id = auth.uid())
      OR sh.sprayer_id IN (SELECT id FROM public.users WHERE auth_id = auth.uid())
    )
  ORDER BY sh.created_at ASC;
$$;

GRANT EXECUTE ON FUNCTION public.get_event_live_spray_holds(UUID) TO authenticated;

-- Expose hold_id on settled sprays so projector can hand off live → confirmed.
DROP FUNCTION IF EXISTS public.get_event_spray_feed(UUID, INT);

CREATE FUNCTION public.get_event_spray_feed(
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
  sprayer_avatar_url TEXT,
  sprayer_avatar_data JSONB,
  hold_id TEXT
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
    u.avatar_url AS sprayer_avatar_url,
    COALESCE(u.avatar_data, '{}'::jsonb) AS sprayer_avatar_data,
    sr.metadata->>'hold_id' AS hold_id
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

GRANT EXECUTE ON FUNCTION public.get_event_spray_feed(UUID, INT) TO authenticated;

DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_publication_tables
    WHERE pubname = 'supabase_realtime' AND schemaname = 'public' AND tablename = 'spray_holds'
  ) THEN
    ALTER PUBLICATION supabase_realtime ADD TABLE public.spray_holds;
  END IF;
END $$;
