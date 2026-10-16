-- Dance floor admin (part 4): moderators (support, super_admin) list guests' floor avatars and take
-- one off the floor. Settings use get/set_spray_floor_settings from 088 (finance, super_admin).
-- The file stays in the avatar-floor bucket (storage objects can't be deleted from SQL) but is never
-- shown again: get_event_floor only builds a path from avatar_data.floorVersion.

CREATE OR REPLACE FUNCTION public._is_floor_moderator()
RETURNS boolean LANGUAGE sql STABLE SECURITY DEFINER SET search_path = public AS $$
  SELECT auth.uid() IS NOT NULL
     AND (public.has_admin_role(auth.uid(), 'super_admin') OR public.has_admin_role(auth.uid(), 'support'))
$$;

CREATE OR REPLACE FUNCTION public.admin_list_floor_avatars(p_search text DEFAULT NULL, p_limit int DEFAULT 50)
RETURNS TABLE (user_id uuid, auth_id uuid, username text, full_name text, avatar_url text, floor_version bigint)
LANGUAGE plpgsql STABLE SECURITY DEFINER SET search_path = public AS $$
DECLARE v_q text := NULLIF(trim(COALESCE(p_search, '')), '');
BEGIN
  IF NOT public._is_floor_moderator() THEN RAISE EXCEPTION 'Not authorized'; END IF;
  RETURN QUERY
    SELECT u.id, u.auth_id, u.username::text, u.full_name::text, u.avatar_url::text,
           (u.avatar_data->>'floorVersion')::bigint
      FROM public.users u
     WHERE jsonb_typeof(u.avatar_data->'floorVersion') = 'number'
       AND (v_q IS NULL OR u.username ILIKE '%' || v_q || '%' OR u.full_name ILIKE '%' || v_q || '%')
     ORDER BY (u.avatar_data->>'floorVersion')::bigint DESC
     LIMIT LEAST(GREATEST(COALESCE(p_limit, 50), 1), 200);
END;
$$;

CREATE OR REPLACE FUNCTION public.admin_clear_floor_avatar(p_user_id uuid, p_reason text DEFAULT NULL)
RETURNS void LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
DECLARE v_version jsonb;
BEGIN
  IF NOT public._is_floor_moderator() THEN RAISE EXCEPTION 'Not authorized'; END IF;
  UPDATE public.users
     SET avatar_data = avatar_data - 'floorVersion'
   WHERE id = p_user_id
  RETURNING NULL INTO v_version;
  IF NOT FOUND THEN RAISE EXCEPTION 'User not found'; END IF;
  INSERT INTO public.admin_audit_log (admin_user_id, action, target_type, target_id, details)
  VALUES (auth.uid(), 'floor_avatar_removed', 'user', p_user_id,
          jsonb_build_object('reason', left(COALESCE(p_reason, ''), 500)));
END;
$$;

REVOKE ALL ON FUNCTION public._is_floor_moderator() FROM PUBLIC, anon, authenticated;
REVOKE ALL ON FUNCTION public.admin_list_floor_avatars(text, int) FROM PUBLIC, anon, authenticated;
REVOKE ALL ON FUNCTION public.admin_clear_floor_avatar(uuid, text) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public._is_floor_moderator() TO service_role;
GRANT EXECUTE ON FUNCTION public.admin_list_floor_avatars(text, int) TO authenticated, service_role;
GRANT EXECUTE ON FUNCTION public.admin_clear_floor_avatar(uuid, text) TO authenticated, service_role;
