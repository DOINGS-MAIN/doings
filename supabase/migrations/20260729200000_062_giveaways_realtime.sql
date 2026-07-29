-- Enable Realtime for live giveaway slot updates on the event projector.

DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_publication_tables
    WHERE pubname = 'supabase_realtime'
      AND schemaname = 'public'
      AND tablename = 'giveaways'
  ) THEN
    ALTER PUBLICATION supabase_realtime ADD TABLE public.giveaways;
  END IF;
END $$;

-- Required for postgres_changes filters on non-PK columns (event_id).
ALTER TABLE public.giveaways REPLICA IDENTITY FULL;
