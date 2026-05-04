-- participant_count should reflect guests (and co-hosts), not the primary host row.

CREATE OR REPLACE FUNCTION public.update_event_participant_count()
RETURNS TRIGGER AS $$
BEGIN
  IF TG_OP = 'INSERT' THEN
    IF NEW.role = 'host' THEN
      RETURN NEW;
    END IF;
    UPDATE public.events
    SET participant_count = participant_count + 1
    WHERE id = NEW.event_id;
  ELSIF TG_OP = 'DELETE' THEN
    IF OLD.role = 'host' THEN
      RETURN OLD;
    END IF;
    UPDATE public.events
    SET participant_count = participant_count - 1
    WHERE id = OLD.event_id;
  END IF;
  RETURN COALESCE(NEW, OLD);
END;
$$ LANGUAGE plpgsql SECURITY DEFINER;

UPDATE public.events e
SET participant_count = (
  SELECT COUNT(*)::int
  FROM public.event_participants ep
  WHERE ep.event_id = e.id
    AND ep.role IS DISTINCT FROM 'host'
);
