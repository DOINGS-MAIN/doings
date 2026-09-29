-- New app only: Discover shows other people's public events; the caller's own are in 'hosted'.

-- ── Event lists: discover excludes the caller's own events ──
CREATE OR REPLACE FUNCTION public.get_events_feed(
  p_scope TEXT,
  p_limit INT DEFAULT 50,
  p_offset INT DEFAULT 0
)
RETURNS TABLE (
  id UUID,
  host_id UUID,
  title TEXT,
  type public.event_type,
  description TEXT,
  location TEXT,
  event_date DATE,
  event_time TIME,
  scheduled_at TIMESTAMPTZ,
  event_code TEXT,
  status public.event_status,
  is_private BOOLEAN,
  max_participants INT,
  participant_count INT,
  total_sprayed BIGINT,
  cover_url TEXT,
  started_at TIMESTAMPTZ,
  ended_at TIMESTAMPTZ,
  created_at TIMESTAMPTZ,
  host_username TEXT,
  host_full_name TEXT,
  host_avatar_url TEXT,
  is_host BOOLEAN,
  is_joined BOOLEAN
)
LANGUAGE plpgsql
STABLE
SECURITY DEFINER
SET search_path = public
AS $$
#variable_conflict use_column
DECLARE
  v_caller UUID;
  v_limit INT := LEAST(GREATEST(COALESCE(p_limit, 50), 1), 100);
  v_offset INT := GREATEST(COALESCE(p_offset, 0), 0);
BEGIN
  IF p_scope IS NULL OR p_scope NOT IN ('discover', 'hosted', 'joined') THEN
    RAISE EXCEPTION 'Invalid scope';
  END IF;

  SELECT u.id INTO v_caller FROM public.users u WHERE u.auth_id = auth.uid();

  RETURN QUERY
  SELECT
    e.id,
    e.host_id,
    e.title::TEXT,
    e.type,
    e.description,
    e.location::TEXT,
    e.event_date,
    e.event_time,
    e.scheduled_at,
    e.event_code::TEXT,
    e.status,
    COALESCE(e.is_private, false),
    e.max_participants,
    e.participant_count,
    e.total_sprayed,
    e.cover_url,
    e.started_at,
    e.ended_at,
    e.created_at,
    h.username::TEXT,
    h.full_name::TEXT,
    h.avatar_url,
    COALESCE(e.host_id = v_caller, false),
    (mp.id IS NOT NULL)
  FROM public.events e
  JOIN public.users h ON h.id = e.host_id
  LEFT JOIN public.event_participants mp
    ON mp.event_id = e.id AND mp.user_id = v_caller AND mp.role <> 'host'
  WHERE CASE p_scope
    WHEN 'discover' THEN
      COALESCE(e.is_private, false) = false
      AND e.status <> 'ended'
      AND COALESCE(e.flagged, false) = false
      -- Drafts only once they have an upcoming date; live events always show.
      AND (e.status = 'live' OR e.event_date >= CURRENT_DATE)
      -- Your own events live under hosted / My Events, not Discover.
      AND e.host_id IS DISTINCT FROM v_caller
    WHEN 'hosted' THEN e.host_id = v_caller
    ELSE mp.id IS NOT NULL
  END
  ORDER BY
    CASE WHEN p_scope = 'discover' AND e.status = 'live' THEN 0 ELSE 1 END,
    CASE WHEN p_scope = 'discover' THEN e.event_date END ASC NULLS LAST,
    CASE WHEN p_scope = 'joined' THEN mp.joined_at END DESC NULLS LAST,
    e.created_at DESC
  LIMIT v_limit OFFSET v_offset;
END;
$$;

