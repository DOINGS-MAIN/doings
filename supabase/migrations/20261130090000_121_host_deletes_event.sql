-- 121: a host can delete any of their events.
-- Until now only an event that had never gone live could be deleted. An event that has been live has
-- sprays, giveaways and guests attached, so it cannot simply be removed: guests would lose their
-- history and the books would stop adding up. Such an event is now marked deleted instead: it leaves
-- the host's events, Discover, join links and the giveaway picker, while its records stay. The events
-- edge function ends a live event first, then marks it. The admin still sees it, marked as deleted.
--
-- The four functions below are as they were live on 2026-11-29, with one added condition each.

ALTER TABLE public.events ADD COLUMN IF NOT EXISTS deleted_at timestamptz;
COMMENT ON COLUMN public.events.deleted_at IS 'Set when the host deleted an event that has records attached (soft delete). Always ended first.';

CREATE OR REPLACE FUNCTION public.get_events_feed(p_scope text, p_limit integer DEFAULT 50, p_offset integer DEFAULT 0)
 RETURNS TABLE(id uuid, host_id uuid, title text, type event_type, description text, location text, event_date date, event_time time without time zone, scheduled_at timestamp with time zone, event_code text, status event_status, is_private boolean, max_participants integer, participant_count integer, total_sprayed bigint, cover_url text, started_at timestamp with time zone, ended_at timestamp with time zone, created_at timestamp with time zone, host_username text, host_full_name text, host_avatar_url text, is_host boolean, is_joined boolean)
 LANGUAGE plpgsql
 STABLE SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
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
  WHERE e.deleted_at IS NULL AND CASE p_scope
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
$function$;

CREATE OR REPLACE FUNCTION public.get_event_view(p_event_id uuid DEFAULT NULL::uuid, p_code text DEFAULT NULL::text)
 RETURNS TABLE(id uuid, host_id uuid, title text, type event_type, description text, location text, event_date date, event_time time without time zone, scheduled_at timestamp with time zone, event_code text, status event_status, is_private boolean, max_participants integer, participant_count integer, total_sprayed bigint, cover_url text, started_at timestamp with time zone, ended_at timestamp with time zone, created_at timestamp with time zone, host_username text, host_full_name text, host_avatar_url text, is_host boolean, is_joined boolean)
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
#variable_conflict use_column
DECLARE
  v_caller UUID;
  v_code TEXT := NULLIF(upper(regexp_replace(COALESCE(p_code, ''), '[\s-]', '', 'g')), '');
  v_limit_key TEXT := 'evcode-miss:' || auth.uid()::text;   -- NULL for a server-side caller
BEGIN
  IF (p_event_id IS NULL) = (v_code IS NULL) THEN
    RAISE EXCEPTION 'event_id or code is required';
  END IF;

  IF v_code IS NOT NULL AND v_limit_key IS NOT NULL AND (
    SELECT count(*) FROM public.rate_limit_hits
    WHERE key = v_limit_key AND hit_at > now() - interval '10 minutes'
  ) >= 20 THEN
    RAISE EXCEPTION 'Too many wrong codes. Wait a few minutes and try again.';
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
  WHERE ((p_event_id IS NOT NULL AND e.id = p_event_id)
     OR (v_code IS NOT NULL AND e.event_code = v_code))
    -- A deleted event is gone for everyone except the guests who were in it, who see it as ended.
    AND (e.deleted_at IS NULL OR mp.id IS NOT NULL)
  LIMIT 1;

  IF NOT FOUND AND v_code IS NOT NULL AND v_limit_key IS NOT NULL THEN
    PERFORM public.consume_rate_limit(v_limit_key, 20, 600);
  END IF;
END;
$function$;

CREATE OR REPLACE FUNCTION public.get_invite_preview(p_kind text, p_code text)
 RETURNS jsonb
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
DECLARE
  v_code text := NULLIF(upper(regexp_replace(COALESCE(p_code, ''), '[\s-]', '', 'g')), '');
  v_key text;
  r record;
BEGIN
  IF v_code IS NULL OR p_kind NOT IN ('event', 'giveaway') THEN RETURN NULL; END IF;
  v_key := CASE WHEN auth.uid() IS NULL THEN 'invite-preview:anon' ELSE 'invite-preview:' || auth.uid()::text END;
  IF NOT public.consume_rate_limit(v_key, CASE WHEN auth.uid() IS NULL THEN 600 ELSE 60 END, 60) THEN
    RAISE EXCEPTION 'Too many lookups. Try again in a minute.';
  END IF;

  IF p_kind = 'event' THEN
    SELECT e.title, e.cover_url, e.status, e.is_private, e.scheduled_at,
           COALESCE(NULLIF(trim(u.full_name), ''), NULLIF(trim(u.username), '')) AS host_name
      INTO r
      FROM public.events e JOIN public.users u ON u.id = e.host_id
     WHERE upper(e.event_code) = v_code AND e.deleted_at IS NULL
     LIMIT 1;
    IF NOT FOUND THEN RETURN NULL; END IF;
    IF r.is_private THEN
      RETURN jsonb_build_object('kind', 'event', 'is_private', true, 'is_live', r.status = 'live',
                                'title', NULL, 'host_name', NULL, 'cover_url', NULL, 'scheduled_at', NULL);
    END IF;
    RETURN jsonb_build_object('kind', 'event', 'is_private', false, 'is_live', r.status = 'live',
                              'title', r.title, 'host_name', r.host_name, 'cover_url', r.cover_url,
                              'scheduled_at', r.scheduled_at, 'status', r.status);
  END IF;

  SELECT g.title, g.status, g.per_person_amount,
         CASE WHEN g.status = 'active' AND g.per_person_amount > 0 THEN (g.remaining_amount / g.per_person_amount)::int ELSE 0 END AS spots_left,
         public.giveaway_creator_name(cu.full_name, cu.username) AS creator_name
    INTO r
    FROM public.giveaways g JOIN public.users cu ON cu.id = g.creator_id
   WHERE g.code = v_code
   LIMIT 1;
  IF NOT FOUND THEN RETURN NULL; END IF;
  RETURN jsonb_build_object('kind', 'giveaway', 'title', r.title, 'status', r.status,
                            'per_person_amount', r.per_person_amount, 'spots_left', r.spots_left,
                            'creator_name', r.creator_name);
END;
$function$;

CREATE OR REPLACE FUNCTION public.get_my_live_events_for_giveaway()
 RETURNS SETOF events
 LANGUAGE sql
 STABLE SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
  SELECT DISTINCT e.*
  FROM public.events e
  JOIN public.users u ON u.auth_id = auth.uid()
  WHERE e.status = 'live' AND e.deleted_at IS NULL
    AND (
      e.host_id = u.id
      OR EXISTS (
        SELECT 1
        FROM public.event_participants ep
        WHERE ep.event_id = e.id
          AND ep.user_id = u.id
      )
    )
  ORDER BY e.started_at DESC NULLS LAST, e.created_at DESC;
$function$;
