-- Migration 009: Events & Participants
-- ================================================

CREATE TABLE public.events (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  host_id UUID NOT NULL REFERENCES public.users(id),
  title VARCHAR(200) NOT NULL,
  type event_type NOT NULL,
  description TEXT,
  location VARCHAR(500),
  event_date DATE,
  event_time TIME,
  event_code VARCHAR(10) NOT NULL UNIQUE,
  status event_status NOT NULL DEFAULT 'draft',
  is_private BOOLEAN DEFAULT false,
  max_participants INT,
  participant_count INT NOT NULL DEFAULT 0,
  total_sprayed BIGINT NOT NULL DEFAULT 0,
  flagged BOOLEAN DEFAULT false,
  flag_reason TEXT,
  flagged_by UUID REFERENCES auth.users(id),
  flagged_at TIMESTAMPTZ,
  scheduled_at TIMESTAMPTZ,
  started_at TIMESTAMPTZ,
  ended_at TIMESTAMPTZ,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE INDEX idx_events_host ON public.events(host_id);
CREATE INDEX idx_events_code ON public.events(event_code);
CREATE INDEX idx_events_status ON public.events(status);
CREATE INDEX idx_events_date ON public.events(event_date);
CREATE INDEX idx_events_flagged ON public.events(flagged) WHERE flagged = true;

CREATE TRIGGER tr_events_updated_at
  BEFORE UPDATE ON public.events
  FOR EACH ROW EXECUTE FUNCTION public.update_updated_at();

CREATE OR REPLACE FUNCTION public.generate_event_code()
RETURNS TRIGGER AS $$
DECLARE
  chars TEXT := 'ABCDEFGHJKMNPQRSTUVWXYZ23456789';
  generated_code TEXT;
  i INT;
BEGIN
  IF NEW.event_code IS NULL OR NEW.event_code = '' THEN
    LOOP
      generated_code := '';
      FOR i IN 1..6 LOOP
        generated_code := generated_code || substr(chars, floor(random() * length(chars) + 1)::int, 1);
      END LOOP;
      EXIT WHEN NOT EXISTS (SELECT 1 FROM public.events WHERE event_code = generated_code);
    END LOOP;
    NEW.event_code := generated_code;
  END IF;
  RETURN NEW;
END;
$$ LANGUAGE plpgsql;

CREATE TRIGGER tr_events_generate_code
  BEFORE INSERT ON public.events
  FOR EACH ROW EXECUTE FUNCTION public.generate_event_code();

CREATE TABLE public.event_participants (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  event_id UUID NOT NULL REFERENCES public.events(id) ON DELETE CASCADE,
  user_id UUID NOT NULL REFERENCES public.users(id),
  role VARCHAR(20) NOT NULL DEFAULT 'guest'
    CHECK (role IN ('host', 'guest', 'co-host')),
  total_sprayed BIGINT NOT NULL DEFAULT 0,
  joined_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  UNIQUE (event_id, user_id)
);

CREATE INDEX idx_participants_event ON public.event_participants(event_id);
CREATE INDEX idx_participants_user ON public.event_participants(user_id);

CREATE OR REPLACE FUNCTION public.update_event_participant_count()
RETURNS TRIGGER AS $$
BEGIN
  IF TG_OP = 'INSERT' THEN
    UPDATE public.events
    SET participant_count = participant_count + 1
    WHERE id = NEW.event_id;
  ELSIF TG_OP = 'DELETE' THEN
    UPDATE public.events
    SET participant_count = participant_count - 1
    WHERE id = OLD.event_id;
  END IF;
  RETURN COALESCE(NEW, OLD);
END;
$$ LANGUAGE plpgsql SECURITY DEFINER;

CREATE TRIGGER tr_participant_count
  AFTER INSERT OR DELETE ON public.event_participants
  FOR EACH ROW EXECUTE FUNCTION public.update_event_participant_count();
