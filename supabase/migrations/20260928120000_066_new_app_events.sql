-- New app (DOINGSNEWFACE) events support. Additive only: nothing existing changes, and the
-- current app ignores all of it.
--   * events.cover_url + public `event-covers` bucket for event cover photos
--   * get_events_feed / get_event_view: events with host display info and caller flags
--     (public.users and event_participants are not readable from the client under RLS)

ALTER TABLE public.events ADD COLUMN IF NOT EXISTS cover_url TEXT;

-- ── Cover photos: <auth uid>/<event id>.<ext> ──
INSERT INTO storage.buckets (id, name, public, file_size_limit, allowed_mime_types)
VALUES (
  'event-covers',
  'event-covers',
  true,
  5242880,
  ARRAY['image/jpeg', 'image/png', 'image/webp']
)
ON CONFLICT (id) DO NOTHING;

DROP POLICY IF EXISTS "Event covers are publicly readable" ON storage.objects;
CREATE POLICY "Event covers are publicly readable"
  ON storage.objects FOR SELECT
  USING (bucket_id = 'event-covers');

DROP POLICY IF EXISTS "Users can upload own event covers" ON storage.objects;
CREATE POLICY "Users can upload own event covers"
  ON storage.objects FOR INSERT TO authenticated
  WITH CHECK (
    bucket_id = 'event-covers'
    AND (storage.foldername(name))[1] = auth.uid()::text
  );

DROP POLICY IF EXISTS "Users can update own event covers" ON storage.objects;
CREATE POLICY "Users can update own event covers"
  ON storage.objects FOR UPDATE TO authenticated
  USING (
    bucket_id = 'event-covers'
    AND (storage.foldername(name))[1] = auth.uid()::text
  );

DROP POLICY IF EXISTS "Users can delete own event covers" ON storage.objects;
CREATE POLICY "Users can delete own event covers"
  ON storage.objects FOR DELETE TO authenticated
  USING (
    bucket_id = 'event-covers'
    AND (storage.foldername(name))[1] = auth.uid()::text
  );

-- ── Event lists: discover / hosted / joined ──
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

-- ── Single event by id or code (no privacy filter, same as GET /events/:id and /code/:code) ──
CREATE OR REPLACE FUNCTION public.get_event_view(
  p_event_id UUID DEFAULT NULL,
  p_code TEXT DEFAULT NULL
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
  v_code TEXT := NULLIF(upper(regexp_replace(COALESCE(p_code, ''), '[\s-]', '', 'g')), '');
BEGIN
  IF (p_event_id IS NULL) = (v_code IS NULL) THEN
    RAISE EXCEPTION 'event_id or code is required';
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
  WHERE (p_event_id IS NOT NULL AND e.id = p_event_id)
     OR (v_code IS NOT NULL AND e.event_code = v_code)
  LIMIT 1;
END;
$$;

REVOKE ALL ON FUNCTION public.get_events_feed(TEXT, INT, INT) FROM PUBLIC;
REVOKE ALL ON FUNCTION public.get_event_view(UUID, TEXT) FROM PUBLIC;
-- Supabase default privileges also grant new functions to anon; signed-out callers must not
-- read private events by id/code (the events edge function requires auth too).
REVOKE ALL ON FUNCTION public.get_events_feed(TEXT, INT, INT) FROM anon;
REVOKE ALL ON FUNCTION public.get_event_view(UUID, TEXT) FROM anon;
GRANT EXECUTE ON FUNCTION public.get_events_feed(TEXT, INT, INT) TO authenticated;
GRANT EXECUTE ON FUNCTION public.get_event_view(UUID, TEXT) TO authenticated;
