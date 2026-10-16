-- Managed ads (spec: DOINGSNEWFACE docs/superpowers/specs/2026-10-16-ads-design.md). The new app's
-- home banner reads get_ads; super_admin and moderation manage ads from the old app's admin.

CREATE TABLE public.ads (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  placement text NOT NULL DEFAULT 'home_banner' CHECK (placement IN ('home_banner')),
  title text NOT NULL CHECK (char_length(btrim(title)) BETWEEN 1 AND 80),
  image_mobile_path text NOT NULL CHECK (image_mobile_path ~ '^[0-9a-f-]{36}\.(jpg|png|webp)$'),
  image_desktop_path text CHECK (image_desktop_path ~ '^[0-9a-f-]{36}\.(jpg|png|webp)$'),
  link_url text CHECK (link_url ~ '^(https://\S+|/([^/\\\s]\S*)?)$'),
  priority int NOT NULL DEFAULT 0,
  starts_at timestamptz NOT NULL DEFAULT now(),
  ends_at timestamptz CHECK (ends_at IS NULL OR ends_at > starts_at),
  is_active boolean NOT NULL DEFAULT true,
  views bigint NOT NULL DEFAULT 0,
  taps bigint NOT NULL DEFAULT 0,
  created_by uuid,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX idx_ads_serving ON public.ads (placement, priority DESC, created_at DESC) WHERE is_active;
CREATE TRIGGER tr_ads_updated_at BEFORE UPDATE ON public.ads
  FOR EACH ROW EXECUTE FUNCTION public.update_updated_at();
ALTER TABLE public.ads ENABLE ROW LEVEL SECURITY;

CREATE TABLE public.ad_events_daily (
  ad_id uuid NOT NULL REFERENCES public.ads(id) ON DELETE CASCADE,
  user_id uuid NOT NULL,
  day date NOT NULL,
  kind text NOT NULL CHECK (kind IN ('view', 'tap')),
  PRIMARY KEY (ad_id, user_id, day, kind)
);
ALTER TABLE public.ad_events_daily ENABLE ROW LEVEL SECURITY;

INSERT INTO storage.buckets (id, name, public, file_size_limit, allowed_mime_types)
VALUES ('ads', 'ads', true, 1048576, ARRAY['image/jpeg', 'image/png', 'image/webp'])
ON CONFLICT (id) DO UPDATE
  SET public = true, file_size_limit = 1048576, allowed_mime_types = ARRAY['image/jpeg', 'image/png', 'image/webp'];

CREATE OR REPLACE FUNCTION public._is_ads_manager()
RETURNS boolean LANGUAGE sql STABLE SECURITY DEFINER SET search_path = public AS $$
  SELECT auth.uid() IS NOT NULL
     AND (public.has_admin_role(auth.uid(), 'super_admin') OR public.has_admin_role(auth.uid(), 'moderation'))
$$;

CREATE POLICY ads_admin_insert ON storage.objects FOR INSERT TO authenticated
  WITH CHECK (bucket_id = 'ads' AND public._is_ads_manager());
CREATE POLICY ads_admin_update ON storage.objects FOR UPDATE TO authenticated
  USING (bucket_id = 'ads' AND public._is_ads_manager());
CREATE POLICY ads_admin_delete ON storage.objects FOR DELETE TO authenticated
  USING (bucket_id = 'ads' AND public._is_ads_manager());

CREATE OR REPLACE FUNCTION public.get_ads(p_placement text)
RETURNS jsonb LANGUAGE sql STABLE SECURITY DEFINER SET search_path = public AS $$
  SELECT COALESCE(jsonb_agg(jsonb_build_object(
           'id', a.id, 'title', a.title, 'image_mobile_path', a.image_mobile_path,
           'image_desktop_path', a.image_desktop_path, 'link_url', a.link_url)
           ORDER BY a.priority DESC, a.created_at DESC), '[]'::jsonb)
    FROM (SELECT * FROM public.ads
           WHERE placement = p_placement AND is_active AND starts_at <= now()
             AND (ends_at IS NULL OR ends_at > now())
           ORDER BY priority DESC, created_at DESC
           LIMIT 10) a
$$;

CREATE OR REPLACE FUNCTION public.record_ad_event(p_ad_id uuid, p_kind text)
RETURNS void LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
DECLARE v_uid uuid := auth.uid();
BEGIN
  IF p_kind NOT IN ('view', 'tap') THEN RAISE EXCEPTION 'Invalid kind'; END IF;
  IF v_uid IS NULL THEN RETURN; END IF;
  IF NOT public.consume_rate_limit('ad_event:' || v_uid, 60, 60) THEN RETURN; END IF;
  IF NOT EXISTS (SELECT 1 FROM public.ads WHERE id = p_ad_id) THEN RETURN; END IF;
  INSERT INTO public.ad_events_daily (ad_id, user_id, day, kind)
  VALUES (p_ad_id, v_uid, (now() AT TIME ZONE 'utc')::date, p_kind)
  ON CONFLICT DO NOTHING;
  IF FOUND THEN
    UPDATE public.ads
       SET views = views + (p_kind = 'view')::int, taps = taps + (p_kind = 'tap')::int
     WHERE id = p_ad_id;
  END IF;
END;
$$;

CREATE OR REPLACE FUNCTION public.admin_list_ads()
RETURNS SETOF public.ads LANGUAGE plpgsql STABLE SECURITY DEFINER SET search_path = public AS $$
BEGIN
  IF NOT public._is_ads_manager() THEN RAISE EXCEPTION 'Not authorized'; END IF;
  RETURN QUERY SELECT * FROM public.ads ORDER BY created_at DESC;
END;
$$;

CREATE OR REPLACE FUNCTION public.admin_upsert_ad(
  p_id uuid, p_title text, p_image_mobile_path text, p_image_desktop_path text, p_link_url text,
  p_priority int, p_starts_at timestamptz, p_ends_at timestamptz)
RETURNS public.ads LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
DECLARE v public.ads;
BEGIN
  IF NOT public._is_ads_manager() THEN RAISE EXCEPTION 'Not authorized'; END IF;
  IF p_id IS NULL THEN
    INSERT INTO public.ads (title, image_mobile_path, image_desktop_path, link_url, priority, starts_at, ends_at, created_by)
    VALUES (btrim(p_title), p_image_mobile_path, NULLIF(p_image_desktop_path, ''), NULLIF(btrim(COALESCE(p_link_url, '')), ''),
            COALESCE(p_priority, 0), COALESCE(p_starts_at, now()), p_ends_at, auth.uid())
    RETURNING * INTO v;
  ELSE
    UPDATE public.ads
       SET title = btrim(p_title), image_mobile_path = p_image_mobile_path,
           image_desktop_path = NULLIF(p_image_desktop_path, ''),
           link_url = NULLIF(btrim(COALESCE(p_link_url, '')), ''),
           priority = COALESCE(p_priority, 0), starts_at = COALESCE(p_starts_at, starts_at), ends_at = p_ends_at
     WHERE id = p_id
    RETURNING * INTO v;
    IF NOT FOUND THEN RAISE EXCEPTION 'Ad not found'; END IF;
  END IF;
  INSERT INTO public.admin_audit_log (admin_user_id, action, target_type, target_id, details)
  VALUES (auth.uid(), CASE WHEN p_id IS NULL THEN 'ad_created' ELSE 'ad_updated' END, 'ad', v.id,
          jsonb_build_object('title', v.title, 'link_url', v.link_url, 'starts_at', v.starts_at, 'ends_at', v.ends_at));
  RETURN v;
END;
$$;

CREATE OR REPLACE FUNCTION public.admin_set_ad_active(p_id uuid, p_active boolean)
RETURNS void LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
BEGIN
  IF NOT public._is_ads_manager() THEN RAISE EXCEPTION 'Not authorized'; END IF;
  UPDATE public.ads SET is_active = p_active WHERE id = p_id;
  IF NOT FOUND THEN RAISE EXCEPTION 'Ad not found'; END IF;
  INSERT INTO public.admin_audit_log (admin_user_id, action, target_type, target_id, details)
  VALUES (auth.uid(), CASE WHEN p_active THEN 'ad_resumed' ELSE 'ad_paused' END, 'ad', p_id, '{}'::jsonb);
END;
$$;

CREATE OR REPLACE FUNCTION public.admin_delete_ad(p_id uuid)
RETURNS text[] LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
DECLARE v public.ads;
BEGIN
  IF NOT public._is_ads_manager() THEN RAISE EXCEPTION 'Not authorized'; END IF;
  DELETE FROM public.ads WHERE id = p_id RETURNING * INTO v;
  IF NOT FOUND THEN RAISE EXCEPTION 'Ad not found'; END IF;
  INSERT INTO public.admin_audit_log (admin_user_id, action, target_type, target_id, details)
  VALUES (auth.uid(), 'ad_deleted', 'ad', p_id, jsonb_build_object('title', v.title, 'views', v.views, 'taps', v.taps));
  RETURN array_remove(ARRAY[v.image_mobile_path, v.image_desktop_path], NULL);
END;
$$;

REVOKE ALL ON FUNCTION public._is_ads_manager() FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public._is_ads_manager() TO authenticated, service_role; -- storage policies call it as the user
REVOKE ALL ON FUNCTION public.get_ads(text) FROM PUBLIC, anon;
REVOKE ALL ON FUNCTION public.record_ad_event(uuid, text) FROM PUBLIC, anon;
REVOKE ALL ON FUNCTION public.admin_list_ads() FROM PUBLIC, anon;
REVOKE ALL ON FUNCTION public.admin_upsert_ad(uuid, text, text, text, text, int, timestamptz, timestamptz) FROM PUBLIC, anon;
REVOKE ALL ON FUNCTION public.admin_set_ad_active(uuid, boolean) FROM PUBLIC, anon;
REVOKE ALL ON FUNCTION public.admin_delete_ad(uuid) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.get_ads(text) TO authenticated, service_role;
GRANT EXECUTE ON FUNCTION public.record_ad_event(uuid, text) TO authenticated, service_role;
GRANT EXECUTE ON FUNCTION public.admin_list_ads() TO authenticated, service_role;
GRANT EXECUTE ON FUNCTION public.admin_upsert_ad(uuid, text, text, text, text, int, timestamptz, timestamptz) TO authenticated, service_role;
GRANT EXECUTE ON FUNCTION public.admin_set_ad_active(uuid, boolean) TO authenticated, service_role;
GRANT EXECUTE ON FUNCTION public.admin_delete_ad(uuid) TO authenticated, service_role;
REVOKE ALL ON public.ads, public.ad_events_daily FROM anon, authenticated;
