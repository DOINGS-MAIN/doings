-- Dance floor avatars and moves (part 3). Spec: DOINGSNEWFACE docs/superpowers/specs/2026-10-15-dance-floor-avatars-design.md
-- Floor avatars live in their own public bucket that only the server (streamoji function) writes to.
-- get_event_floor returns each dancer's object path (never a URL: guests can edit their own
-- avatar_data, so nothing in it is trusted beyond a version number) and up to 3 chosen moves.

-- Server-only bucket: public read, no client write policies, 2.5 MB, GLB only.
INSERT INTO storage.buckets (id, name, public, file_size_limit, allowed_mime_types)
VALUES ('avatar-floor', 'avatar-floor', true, 2621440, ARRAY['model/gltf-binary'])
ON CONFLICT (id) DO UPDATE
  SET public = true, file_size_limit = 2621440, allowed_mime_types = ARRAY['model/gltf-binary'];

-- Atomic merge into users.avatar_data (no read-modify-write races between saves).
CREATE OR REPLACE FUNCTION public.merge_avatar_data(p_auth_id uuid, p_patch jsonb)
RETURNS void LANGUAGE sql SECURITY DEFINER SET search_path = public AS $$
  UPDATE public.users
     SET avatar_data = COALESCE(avatar_data, '{}'::jsonb) || p_patch
   WHERE auth_id = p_auth_id
$$;

-- "<auth_id>.glb?v=<version>" when the version is a plain number; the app adds its own storage host.
CREATE OR REPLACE FUNCTION public._floor_model_path(p_auth uuid, p_version jsonb)
RETURNS text LANGUAGE sql IMMUTABLE AS $$
  SELECT CASE
    WHEN jsonb_typeof(p_version) = 'number' AND (p_version #>> '{}') ~ '^[0-9]{1,16}$'
    THEN p_auth::text || '.glb?v=' || (p_version #>> '{}')
  END
$$;

-- Up to 3 move slugs, else none. Nested CASE: never evaluates array functions on a non-array.
CREATE OR REPLACE FUNCTION public._floor_moves(p jsonb)
RETURNS jsonb LANGUAGE sql IMMUTABLE AS $$
  SELECT CASE
    WHEN jsonb_typeof(p) IS DISTINCT FROM 'array' THEN '[]'::jsonb
    ELSE CASE
      WHEN jsonb_array_length(p) <= 3 AND NOT EXISTS (
        SELECT 1 FROM jsonb_array_elements(p) e
         WHERE jsonb_typeof(e) <> 'string' OR NOT ((e #>> '{}') ~ '^[a-z0-9-]{1,40}$'))
      THEN p
      ELSE '[]'::jsonb
    END
  END
$$;

CREATE OR REPLACE FUNCTION public.get_event_floor(p_event_id uuid)
RETURNS jsonb LANGUAGE plpgsql VOLATILE SECURITY DEFINER SET search_path = public AS $$
DECLARE
  v_event RECORD;
  v_me uuid;
  v_settings jsonb;
  v_floor jsonb;
  v_waiting int;
  v_my RECORD;
  v_me_json jsonb := NULL;
  v_pos int;
  v_eta int;
BEGIN
  SELECT id, host_id, is_private INTO v_event FROM public.events WHERE id = p_event_id;
  IF NOT FOUND THEN RAISE EXCEPTION 'Event not found'; END IF;

  SELECT id INTO v_me FROM public.users WHERE auth_id = auth.uid();
  IF v_event.is_private AND NOT (
       v_me IS NOT NULL AND (v_me = v_event.host_id OR EXISTS (
         SELECT 1 FROM public.event_participants WHERE event_id = p_event_id AND user_id = v_me))) THEN
    RAISE EXCEPTION 'Not authorized';
  END IF;

  PERFORM public.advance_event_floor(p_event_id);
  v_settings := public.floor_settings();

  SELECT COALESCE(jsonb_agg(jsonb_build_object(
           'hold_id', sh.id, 'slot', sh.floor_slot,
           'name', COALESCE(NULLIF(trim(u.full_name), ''), '@' || NULLIF(trim(u.username), ''), 'Guest'),
           'avatar_url', u.avatar_url, 'amount_kobo', sh.planned_amount_kobo,
           'denomination', sh.denomination, 'note_count', sh.note_count,
           'started_at', sh.floor_started_at, 'ends_at', sh.floor_ends_at,
           'floor_seconds', sh.floor_seconds, 'is_me', sh.sprayer_id IS NOT DISTINCT FROM v_me,
           'model_path', public._floor_model_path(u.auth_id, u.avatar_data->'floorVersion'),
           'moves', public._floor_moves(u.avatar_data->'danceMoves'))
         ORDER BY sh.floor_slot), '[]'::jsonb)
    INTO v_floor
    FROM public.spray_holds sh JOIN public.users u ON u.id = sh.sprayer_id
   WHERE sh.event_id = p_event_id AND sh.status = 'on_floor';

  SELECT count(*) INTO v_waiting FROM public.spray_holds WHERE event_id = p_event_id AND status = 'queued';

  IF v_me IS NOT NULL THEN
    SELECT * INTO v_my FROM public.spray_holds
     WHERE event_id = p_event_id AND sprayer_id = v_me AND queued_at IS NOT NULL
       AND (status IN ('queued', 'on_floor') OR settled_at > now() - interval '2 minutes')
     ORDER BY queued_at DESC LIMIT 1;
    IF FOUND THEN
      IF v_my.status = 'queued' THEN
        SELECT count(*) + 1 INTO v_pos FROM public.spray_holds
         WHERE event_id = p_event_id AND status = 'queued' AND (queued_at, id) < (v_my.queued_at, v_my.id);
        v_eta := public.floor_eta_seconds(p_event_id, v_pos);
      END IF;
      v_me_json := jsonb_build_object(
        'hold_id', v_my.id, 'status', v_my.status, 'amount_kobo', v_my.planned_amount_kobo,
        'position', v_pos, 'eta_seconds', v_eta, 'charged_kobo', v_my.charged_amount_kobo,
        'release_reason', v_my.release_reason);
    END IF;
  END IF;

  RETURN jsonb_build_object(
    'server_now', clock_timestamp(),
    'floor', v_floor,
    'waiting_count', v_waiting,
    'next_eta_seconds', public.floor_eta_seconds(p_event_id, v_waiting + 1),
    'bands', v_settings->'bands',
    'busy', jsonb_build_object('threshold', (v_settings->>'busy_threshold')::int,
                               'shrink_pct', (v_settings->>'busy_shrink_pct')::int,
                               'min_seconds', (v_settings->>'min_seconds')::int),
    'me', v_me_json);
END;
$$;

REVOKE ALL ON FUNCTION public.merge_avatar_data(uuid, jsonb) FROM PUBLIC, anon, authenticated;
REVOKE ALL ON FUNCTION public._floor_model_path(uuid, jsonb) FROM PUBLIC, anon, authenticated;
REVOKE ALL ON FUNCTION public._floor_moves(jsonb) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.merge_avatar_data(uuid, jsonb) TO service_role;
GRANT EXECUTE ON FUNCTION public._floor_model_path(uuid, jsonb) TO service_role;
GRANT EXECUTE ON FUNCTION public._floor_moves(jsonb) TO service_role;
REVOKE ALL ON FUNCTION public.get_event_floor(uuid) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.get_event_floor(uuid) TO anon, authenticated, service_role;
