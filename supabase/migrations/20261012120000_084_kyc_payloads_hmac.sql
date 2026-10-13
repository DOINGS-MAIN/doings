-- Migration 084: move Dojah payloads out of the user-readable kyc_verifications row; add HMAC and selfie columns.
-- raw_response held the full plaintext BVN and NIN, and users can select their own row.

CREATE TABLE IF NOT EXISTS public.kyc_verification_payloads (
  kyc_id UUID PRIMARY KEY REFERENCES public.kyc_verifications(id) ON DELETE CASCADE,
  payload JSONB NOT NULL,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now()
);
ALTER TABLE public.kyc_verification_payloads ENABLE ROW LEVEL SECURITY;  -- no policies: service role only
REVOKE ALL ON public.kyc_verification_payloads FROM anon, authenticated;

INSERT INTO public.kyc_verification_payloads (kyc_id, payload)
SELECT id, raw_response FROM public.kyc_verifications
WHERE raw_response IS NOT NULL
ON CONFLICT (kyc_id) DO NOTHING;

UPDATE public.kyc_verifications SET raw_response = NULL WHERE raw_response IS NOT NULL;

ALTER TABLE public.kyc_verifications
  ADD COLUMN IF NOT EXISTS bvn_hmac TEXT,
  ADD COLUMN IF NOT EXISTS nin_hmac TEXT,
  ADD COLUMN IF NOT EXISTS bvn_middle_name VARCHAR(100),
  ADD COLUMN IF NOT EXISTS liveness_score NUMERIC(5,2),
  ADD COLUMN IF NOT EXISTS verification_method TEXT;

ALTER TABLE public.kyc_verifications DROP CONSTRAINT IF EXISTS kyc_verifications_method_check;
ALTER TABLE public.kyc_verifications ADD CONSTRAINT kyc_verifications_method_check
  CHECK (verification_method IS NULL OR verification_method IN ('bvn_nin', 'bvn_selfie'));

UPDATE public.kyc_verifications SET verification_method = 'bvn_nin'
WHERE level = 2 AND verification_method IS NULL;

CREATE INDEX IF NOT EXISTS idx_kyc_bvn_hmac ON public.kyc_verifications (bvn_hmac) WHERE bvn_hmac IS NOT NULL;
