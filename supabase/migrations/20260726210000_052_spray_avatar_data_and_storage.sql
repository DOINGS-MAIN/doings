-- Spray feed returns avatar customization JSON; avatars storage bucket for profile photos.

INSERT INTO storage.buckets (id, name, public, file_size_limit, allowed_mime_types)
VALUES (
  'avatars',
  'avatars',
  true,
  5242880,
  ARRAY['image/jpeg', 'image/png', 'image/webp', 'image/gif']
)
ON CONFLICT (id) DO NOTHING;

DROP POLICY IF EXISTS "Avatar photos are publicly readable" ON storage.objects;
CREATE POLICY "Avatar photos are publicly readable"
  ON storage.objects FOR SELECT
  USING (bucket_id = 'avatars');

DROP POLICY IF EXISTS "Users can upload own avatar photo" ON storage.objects;
CREATE POLICY "Users can upload own avatar photo"
  ON storage.objects FOR INSERT TO authenticated
  WITH CHECK (
    bucket_id = 'avatars'
    AND (storage.foldername(name))[1] = auth.uid()::text
  );

DROP POLICY IF EXISTS "Users can update own avatar photo" ON storage.objects;
CREATE POLICY "Users can update own avatar photo"
  ON storage.objects FOR UPDATE TO authenticated
  USING (
    bucket_id = 'avatars'
    AND (storage.foldername(name))[1] = auth.uid()::text
  );

DROP POLICY IF EXISTS "Users can delete own avatar photo" ON storage.objects;
CREATE POLICY "Users can delete own avatar photo"
  ON storage.objects FOR DELETE TO authenticated
  USING (
    bucket_id = 'avatars'
    AND (storage.foldername(name))[1] = auth.uid()::text
  );

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
  sprayer_avatar_data JSONB
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
    COALESCE(u.avatar_data, '{}'::jsonb) AS sprayer_avatar_data
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

DROP FUNCTION IF EXISTS public.get_event_top_gifters(UUID, INT);

CREATE FUNCTION public.get_event_top_gifters(
  p_event_id UUID,
  p_limit INT DEFAULT 3
)
RETURNS TABLE (
  sprayer_id UUID,
  sprayer_name TEXT,
  sprayer_username TEXT,
  sprayer_avatar_url TEXT,
  sprayer_avatar_data JSONB,
  total_amount BIGINT
)
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path = public
AS $$
  SELECT
    sr.sprayer_id,
    COALESCE(NULLIF(trim(u.full_name), ''), NULLIF(trim(u.username), ''), 'Guest') AS sprayer_name,
    u.username AS sprayer_username,
    u.avatar_url AS sprayer_avatar_url,
    COALESCE(u.avatar_data, '{}'::jsonb) AS sprayer_avatar_data,
    SUM(sr.amount)::BIGINT AS total_amount
  FROM public.spray_records sr
  JOIN public.events e ON e.id = sr.event_id
  JOIN public.users u ON u.id = sr.sprayer_id
  WHERE sr.event_id = p_event_id
    AND (
      e.host_id IN (SELECT id FROM public.users WHERE auth_id = auth.uid())
      OR sr.sprayer_id IN (SELECT id FROM public.users WHERE auth_id = auth.uid())
    )
  GROUP BY sr.sprayer_id, u.full_name, u.username, u.avatar_url, u.avatar_data
  ORDER BY total_amount DESC
  LIMIT LEAST(GREATEST(COALESCE(p_limit, 3), 1), 20);
$$;

GRANT EXECUTE ON FUNCTION public.get_event_spray_feed(UUID, INT) TO authenticated;
GRANT EXECUTE ON FUNCTION public.get_event_top_gifters(UUID, INT) TO authenticated;
