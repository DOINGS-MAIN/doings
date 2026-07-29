-- Public projector: anon viewers can watch live sprayers on non-private events.

CREATE POLICY "Anon can view public live events"
  ON public.events FOR SELECT TO anon
  USING (is_private = false AND status = 'live');

CREATE POLICY "Anon can view spray holds on public live events"
  ON public.spray_holds FOR SELECT TO anon
  USING (
    status = 'pending'
    AND paused_at IS NULL
    AND EXISTS (
      SELECT 1 FROM public.events e
      WHERE e.id = spray_holds.event_id
        AND e.is_private = false
        AND e.status = 'live'
    )
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
    AND sh.paused_at IS NULL
    AND public.spray_hold_session_deadline(sh) > now()
    AND (
      (e.is_private = false AND e.status = 'live')
      OR e.host_id IN (SELECT id FROM public.users WHERE auth_id = auth.uid())
      OR sh.sprayer_id IN (SELECT id FROM public.users WHERE auth_id = auth.uid())
    )
  ORDER BY sh.created_at ASC
  LIMIT 3;
$$;

GRANT EXECUTE ON FUNCTION public.get_event_live_spray_holds(UUID) TO anon;
GRANT EXECUTE ON FUNCTION public.get_event_live_spray_holds(UUID) TO authenticated;
