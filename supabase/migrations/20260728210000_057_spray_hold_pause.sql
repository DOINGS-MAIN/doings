-- Pause removes sprayer from projector; resume rejoins the active queue.

ALTER TABLE public.spray_holds
  ADD COLUMN IF NOT EXISTS paused_at TIMESTAMPTZ;

COMMENT ON COLUMN public.spray_holds.paused_at IS
  'When set, sprayer is off the projector but hold remains until settle/cancel.';

CREATE OR REPLACE FUNCTION public.set_spray_hold_paused(
  p_hold_id UUID,
  p_paused BOOLEAN
)
RETURNS VOID
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_sprayer_id UUID;
BEGIN
  SELECT id INTO v_sprayer_id
  FROM public.users
  WHERE auth_id = auth.uid();

  IF v_sprayer_id IS NULL THEN
    RAISE EXCEPTION 'Not authenticated';
  END IF;

  UPDATE public.spray_holds
  SET paused_at = CASE WHEN p_paused THEN now() ELSE NULL END
  WHERE id = p_hold_id
    AND sprayer_id = v_sprayer_id
    AND status = 'pending';

  IF NOT FOUND THEN
    RAISE EXCEPTION 'Spray hold not found or not pausable';
  END IF;
END;
$$;

GRANT EXECUTE ON FUNCTION public.set_spray_hold_paused(UUID, BOOLEAN) TO authenticated;

-- All pending holds (queue order) — includes paused.
CREATE OR REPLACE FUNCTION public.get_event_spray_queue_holds(p_event_id UUID)
RETURNS TABLE (
  hold_id UUID,
  planned_amount BIGINT,
  denomination INT,
  created_at TIMESTAMPTZ,
  is_paused BOOLEAN,
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
    (sh.paused_at IS NOT NULL) AS is_paused,
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

GRANT EXECUTE ON FUNCTION public.get_event_spray_queue_holds(UUID) TO authenticated;

-- Active (non-paused) sprayers on projector — up to 3 at once.
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
    AND (
      e.host_id IN (SELECT id FROM public.users WHERE auth_id = auth.uid())
      OR sh.sprayer_id IN (SELECT id FROM public.users WHERE auth_id = auth.uid())
    )
  ORDER BY sh.created_at ASC
  LIMIT 3;
$$;

GRANT EXECUTE ON FUNCTION public.get_event_live_spray_holds(UUID) TO authenticated;
