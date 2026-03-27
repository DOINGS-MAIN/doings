-- Migration 010: Spray Records
-- ================================================

CREATE TABLE public.spray_records (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  event_id UUID NOT NULL REFERENCES public.events(id),
  sprayer_id UUID NOT NULL REFERENCES public.users(id),
  receiver_id UUID NOT NULL REFERENCES public.users(id),
  transaction_id UUID REFERENCES public.transactions(id),
  amount BIGINT NOT NULL CHECK (amount > 0),
  denomination INT NOT NULL CHECK (denomination IN (200, 500, 1000)),
  note_count INT NOT NULL CHECK (note_count > 0),
  sprayed_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE INDEX idx_spray_event ON public.spray_records(event_id);
CREATE INDEX idx_spray_sprayer ON public.spray_records(sprayer_id);
CREATE INDEX idx_spray_receiver ON public.spray_records(receiver_id);
CREATE INDEX idx_spray_date ON public.spray_records(sprayed_at DESC);

CREATE OR REPLACE FUNCTION public.update_spray_aggregates()
RETURNS TRIGGER AS $$
BEGIN
  UPDATE public.events
  SET total_sprayed = total_sprayed + NEW.amount
  WHERE id = NEW.event_id;

  UPDATE public.event_participants
  SET total_sprayed = total_sprayed + NEW.amount
  WHERE event_id = NEW.event_id
    AND user_id = NEW.sprayer_id;

  RETURN NEW;
END;
$$ LANGUAGE plpgsql SECURITY DEFINER;

CREATE TRIGGER tr_spray_update_aggregates
  AFTER INSERT ON public.spray_records
  FOR EACH ROW EXECUTE FUNCTION public.update_spray_aggregates();
