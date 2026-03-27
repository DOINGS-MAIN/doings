-- Migration 002: Users Table
-- ================================================

CREATE TABLE public.users (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  auth_id UUID UNIQUE REFERENCES auth.users(id) ON DELETE SET NULL,
  phone VARCHAR(15) NOT NULL UNIQUE,
  email VARCHAR(255),
  full_name VARCHAR(200),
  username VARCHAR(50) UNIQUE,
  avatar_url TEXT,
  avatar_data JSONB DEFAULT '{}',
  kyc_level SMALLINT NOT NULL DEFAULT 0
    CHECK (kyc_level BETWEEN 0 AND 3),
  status VARCHAR(20) NOT NULL DEFAULT 'active'
    CHECK (status IN ('active', 'suspended', 'banned')),
  suspended_reason TEXT,
  suspended_at TIMESTAMPTZ,
  suspended_by UUID,
  date_of_birth DATE,
  address TEXT,
  referral_code VARCHAR(10) UNIQUE,
  referred_by UUID REFERENCES public.users(id),
  last_active_at TIMESTAMPTZ,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE INDEX idx_users_phone ON public.users(phone);
CREATE INDEX idx_users_username ON public.users(username) WHERE username IS NOT NULL;
CREATE INDEX idx_users_status ON public.users(status);
CREATE INDEX idx_users_kyc_level ON public.users(kyc_level);
CREATE INDEX idx_users_auth_id ON public.users(auth_id) WHERE auth_id IS NOT NULL;
CREATE INDEX idx_users_referral ON public.users(referral_code) WHERE referral_code IS NOT NULL;

-- Shared trigger function used by many tables
CREATE OR REPLACE FUNCTION public.update_updated_at()
RETURNS TRIGGER AS $$
BEGIN
  NEW.updated_at = now();
  RETURN NEW;
END;
$$ LANGUAGE plpgsql;

CREATE TRIGGER tr_users_updated_at
  BEFORE UPDATE ON public.users
  FOR EACH ROW EXECUTE FUNCTION public.update_updated_at();

CREATE OR REPLACE FUNCTION public.generate_referral_code()
RETURNS TRIGGER AS $$
DECLARE
  chars TEXT := 'ABCDEFGHJKMNPQRSTUVWXYZ23456789';
  code TEXT;
  i INT;
BEGIN
  IF NEW.referral_code IS NULL THEN
    LOOP
      code := '';
      FOR i IN 1..8 LOOP
        code := code || substr(chars, floor(random() * length(chars) + 1)::int, 1);
      END LOOP;
      EXIT WHEN NOT EXISTS (SELECT 1 FROM public.users WHERE referral_code = code);
    END LOOP;
    NEW.referral_code := code;
  END IF;
  RETURN NEW;
END;
$$ LANGUAGE plpgsql;

CREATE TRIGGER tr_users_referral_code
  BEFORE INSERT ON public.users
  FOR EACH ROW EXECUTE FUNCTION public.generate_referral_code();
