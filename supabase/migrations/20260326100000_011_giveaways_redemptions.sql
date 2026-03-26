-- Migration 011: Giveaways & Redemptions
-- ================================================

CREATE TABLE public.giveaways (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  creator_id UUID NOT NULL REFERENCES public.users(id),
  title VARCHAR(200) NOT NULL,
  total_amount BIGINT NOT NULL CHECK (total_amount >= 10000),
  per_person_amount BIGINT NOT NULL CHECK (per_person_amount >= 1000),
  remaining_amount BIGINT NOT NULL,
  max_recipients INT GENERATED ALWAYS AS (total_amount / per_person_amount) STORED,
  code VARCHAR(10) NOT NULL UNIQUE,
  status giveaway_status NOT NULL DEFAULT 'active',
  type giveaway_type NOT NULL,
  event_id UUID REFERENCES public.events(id),
  is_private BOOLEAN DEFAULT false,
  show_on_event_screen BOOLEAN DEFAULT true,
  funding_transaction_id UUID REFERENCES public.transactions(id),
  refund_transaction_id UUID REFERENCES public.transactions(id),
  stopped_at TIMESTAMPTZ,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  CONSTRAINT ck_per_person_lte_total CHECK (per_person_amount <= total_amount),
  CONSTRAINT ck_remaining_non_negative CHECK (remaining_amount >= 0)
);

CREATE INDEX idx_giveaways_creator ON public.giveaways(creator_id);
CREATE INDEX idx_giveaways_code ON public.giveaways(code);
CREATE INDEX idx_giveaways_event ON public.giveaways(event_id);
CREATE INDEX idx_giveaways_status ON public.giveaways(status);

CREATE OR REPLACE FUNCTION public.generate_giveaway_code()
RETURNS TRIGGER AS $$
DECLARE
  chars TEXT := 'ABCDEFGHJKMNPQRSTUVWXYZ23456789';
  generated_code TEXT;
  i INT;
BEGIN
  IF NEW.code IS NULL OR NEW.code = '' THEN
    LOOP
      generated_code := '';
      FOR i IN 1..6 LOOP
        generated_code := generated_code || substr(chars, floor(random() * length(chars) + 1)::int, 1);
      END LOOP;
      EXIT WHEN NOT EXISTS (SELECT 1 FROM public.giveaways WHERE code = generated_code);
    END LOOP;
    NEW.code := generated_code;
  END IF;
  RETURN NEW;
END;
$$ LANGUAGE plpgsql;

CREATE TRIGGER tr_giveaway_generate_code
  BEFORE INSERT ON public.giveaways
  FOR EACH ROW EXECUTE FUNCTION public.generate_giveaway_code();

CREATE TABLE public.giveaway_redemptions (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  giveaway_id UUID NOT NULL REFERENCES public.giveaways(id),
  user_id UUID NOT NULL REFERENCES public.users(id),
  amount BIGINT NOT NULL CHECK (amount > 0),
  transaction_id UUID REFERENCES public.transactions(id),
  redeemed_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  UNIQUE (giveaway_id, user_id)
);

CREATE INDEX idx_redemptions_giveaway ON public.giveaway_redemptions(giveaway_id);
CREATE INDEX idx_redemptions_user ON public.giveaway_redemptions(user_id);

CREATE OR REPLACE FUNCTION public.update_giveaway_on_redemption()
RETURNS TRIGGER AS $$
BEGIN
  UPDATE public.giveaways
  SET remaining_amount = remaining_amount - NEW.amount,
      status = CASE
        WHEN remaining_amount - NEW.amount < per_person_amount THEN 'exhausted'::giveaway_status
        ELSE status
      END
  WHERE id = NEW.giveaway_id;
  RETURN NEW;
END;
$$ LANGUAGE plpgsql SECURITY DEFINER;

CREATE TRIGGER tr_redemption_update_giveaway
  AFTER INSERT ON public.giveaway_redemptions
  FOR EACH ROW EXECUTE FUNCTION public.update_giveaway_on_redemption();
