-- Migration 004: KYC Verifications
-- ================================================

CREATE TABLE public.kyc_verifications (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id UUID NOT NULL REFERENCES public.users(id) ON DELETE CASCADE,
  level SMALLINT NOT NULL CHECK (level BETWEEN 1 AND 3),
  status kyc_status NOT NULL DEFAULT 'pending',
  provider VARCHAR(20) NOT NULL DEFAULT 'dojah',
  provider_ref VARCHAR(100),

  -- Level 1 data
  verified_phone VARCHAR(15),
  verified_email VARCHAR(255),

  -- Level 2 data (never store raw BVN)
  bvn_hash VARCHAR(64),
  bvn_last_four VARCHAR(4),
  bvn_first_name VARCHAR(100),
  bvn_last_name VARCHAR(100),
  bvn_phone VARCHAR(15),
  bvn_dob DATE,

  -- Level 3 data (never store raw NIN)
  nin_hash VARCHAR(64),
  nin_last_four VARCHAR(4),
  selfie_match_confidence DECIMAL(5,2),
  selfie_image_ref VARCHAR(255),

  reviewed_by UUID REFERENCES auth.users(id),
  reviewed_at TIMESTAMPTZ,
  rejection_reason TEXT,
  submitted_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  verified_at TIMESTAMPTZ,
  raw_response JSONB,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE INDEX idx_kyc_user ON public.kyc_verifications(user_id);
CREATE INDEX idx_kyc_status ON public.kyc_verifications(status);
CREATE INDEX idx_kyc_level ON public.kyc_verifications(level);
CREATE INDEX idx_kyc_pending ON public.kyc_verifications(status, created_at)
  WHERE status = 'pending';

CREATE OR REPLACE FUNCTION public.update_user_kyc_level()
RETURNS TRIGGER AS $$
BEGIN
  IF NEW.status = 'verified' THEN
    UPDATE public.users
    SET kyc_level = GREATEST(kyc_level, NEW.level),
        updated_at = now()
    WHERE id = NEW.user_id;
  END IF;
  RETURN NEW;
END;
$$ LANGUAGE plpgsql SECURITY DEFINER;

CREATE TRIGGER tr_kyc_update_user_level
  AFTER UPDATE OF status ON public.kyc_verifications
  FOR EACH ROW
  WHEN (NEW.status = 'verified')
  EXECUTE FUNCTION public.update_user_kyc_level();
