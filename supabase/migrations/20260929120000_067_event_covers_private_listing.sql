-- Follow-up to 066: a public bucket serves /object/public/ URLs without any SELECT policy, so
-- the broad SELECT policy only enabled *listing* event-covers (exposing auth uids and private
-- event ids). Keep SELECT for the owner's own folder, which storage upserts/updates need.

DROP POLICY IF EXISTS "Event covers are publicly readable" ON storage.objects;

DROP POLICY IF EXISTS "Users can read own event covers" ON storage.objects;
CREATE POLICY "Users can read own event covers"
  ON storage.objects FOR SELECT TO authenticated
  USING (
    bucket_id = 'event-covers'
    AND (storage.foldername(name))[1] = auth.uid()::text
  );
