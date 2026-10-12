-- Migration 085: trim KYC payloads, drop reversible SHA-256 hashes, serialise the rate limiter and let callers
-- release a hit, liveness pass-mark setting, notification on verified insert. Requires the HMAC backfill.

DO $$
BEGIN
  IF EXISTS (
    SELECT 1 FROM public.kyc_verifications k
    JOIN public.kyc_verification_payloads p ON p.kyc_id = k.id
    WHERE k.status = 'verified' AND k.level = 2 AND k.bvn_hmac IS NULL
  ) THEN
    RAISE EXCEPTION 'Run kyc-hmac-backfill first: a verified level-2 row with a payload has no bvn_hmac';
  END IF;
END $$;

-- Keep names and DOB only; numbers, phone, address and photos go.
UPDATE public.kyc_verification_payloads p
SET payload = jsonb_strip_nulls(jsonb_build_object(
  'source', 'bvn_nin',
  'bvn', jsonb_build_object(
    'first_name', e.bvn->>'first_name', 'middle_name', e.bvn->>'middle_name',
    'last_name', e.bvn->>'last_name', 'date_of_birth', e.bvn->>'date_of_birth'),
  'nin', jsonb_build_object(
    'first_name', e.nin->>'first_name', 'middle_name', e.nin->>'middle_name', 'last_name', e.nin->>'last_name')))
FROM (
  SELECT kyc_id,
    COALESCE(payload->'bvn'->'entity', payload->'bvn'->'data', payload->'bvn') AS bvn,
    COALESCE(payload->'nin'->'entity', payload->'nin'->'data', payload->'nin') AS nin
  FROM public.kyc_verification_payloads
  WHERE NOT (payload ? 'source')
) e
WHERE p.kyc_id = e.kyc_id;

UPDATE public.kyc_verifications SET bvn_hash = NULL, nin_hash = NULL
WHERE bvn_hash IS NOT NULL OR nin_hash IS NOT NULL;

-- ── Rate limiter: count + insert under a per-key lock, so parallel calls can't pass the cap ──
CREATE OR REPLACE FUNCTION public.consume_rate_limit(p_key TEXT, p_max INT, p_window_seconds INT)
RETURNS BOOLEAN
LANGUAGE plpgsql
VOLATILE
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_count INT;
BEGIN
  PERFORM pg_advisory_xact_lock(hashtext(p_key));

  DELETE FROM public.rate_limit_hits
  WHERE key = p_key AND hit_at < now() - make_interval(secs => p_window_seconds);

  SELECT count(*) INTO v_count FROM public.rate_limit_hits WHERE key = p_key;
  IF v_count >= p_max THEN
    RETURN false;
  END IF;

  INSERT INTO public.rate_limit_hits (key) VALUES (p_key);
  RETURN true;
END;
$$;

-- Gives back the newest hit (e.g. the provider was down, so the attempt shouldn't count).
CREATE OR REPLACE FUNCTION public.release_rate_limit(p_key TEXT)
RETURNS VOID
LANGUAGE plpgsql
VOLATILE
SECURITY DEFINER
SET search_path = public
AS $$
BEGIN
  PERFORM pg_advisory_xact_lock(hashtext(p_key));
  DELETE FROM public.rate_limit_hits
  WHERE ctid = (SELECT ctid FROM public.rate_limit_hits WHERE key = p_key ORDER BY hit_at DESC LIMIT 1);
END;
$$;

REVOKE ALL ON FUNCTION public.consume_rate_limit(TEXT, INT, INT) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.consume_rate_limit(TEXT, INT, INT) TO service_role;
REVOKE ALL ON FUNCTION public.release_rate_limit(TEXT) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.release_rate_limit(TEXT) TO service_role;

-- ── Liveness pass mark (0–100; Dojah publishes none; set from the sandbox trial) ──
ALTER TABLE public.platform_settings
  ADD COLUMN IF NOT EXISTS kyc_liveness_min_score NUMERIC(5,2) NOT NULL DEFAULT 50
  CHECK (kyc_liveness_min_score BETWEEN 0 AND 100);

-- ── "KYC verified" on insert (tr_notify_kyc_status only fires on UPDATE OF status) ──
CREATE OR REPLACE FUNCTION public.notify_kyc_verified_insert()
RETURNS TRIGGER
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
BEGIN
  PERFORM public.create_notification(
    NEW.user_id, 'kyc_approved', 'KYC Verified',
    'Your level ' || NEW.level || ' verification has been approved. You now have access to more features.',
    jsonb_build_object('kyc_id', NEW.id, 'level', NEW.level, 'status', NEW.status)
  );
  RETURN NEW;
END;
$$;
REVOKE ALL ON FUNCTION public.notify_kyc_verified_insert() FROM PUBLIC, anon, authenticated;

DROP TRIGGER IF EXISTS tr_notify_kyc_verified_insert ON public.kyc_verifications;
CREATE TRIGGER tr_notify_kyc_verified_insert
  AFTER INSERT ON public.kyc_verifications
  FOR EACH ROW
  WHEN (NEW.status = 'verified')
  EXECUTE FUNCTION public.notify_kyc_verified_insert();
