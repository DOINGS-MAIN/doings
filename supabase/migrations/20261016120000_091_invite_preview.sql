-- Invite preview for scanned QR links (new app): what a signed-out guest sees before signing up.
-- Read-only and minimal: no ids, nothing about private events beyond "private", giveaway facts
-- a code-holder can see anyway. Rate-limited: per user when signed in, one shared bucket for
-- signed-out lookups (codes are 6 characters; this keeps bulk guessing slow).

CREATE OR REPLACE FUNCTION public.get_invite_preview(p_kind text, p_code text)
RETURNS jsonb LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
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
     WHERE upper(e.event_code) = v_code
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
$$;

REVOKE ALL ON FUNCTION public.get_invite_preview(text, text) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.get_invite_preview(text, text) TO anon, authenticated, service_role;
