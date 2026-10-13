-- Migration 086: one BVN per person (approved duplicates report, 2026-10-13).
-- • Per shared BVN, the person verified earliest keeps level 2; the others' records are rejected and they drop to 1.
-- • One person with several verified records (re-verification) keeps the newest; older ones are marked superseded
--   (no status change, so no notification). kyc-dojah-verify supersedes a user's own older records the same way.
-- • System accounts (*@doings.internal, e.g. the treasury) are never touched.

ALTER TABLE public.kyc_verifications ADD COLUMN IF NOT EXISTS superseded_at TIMESTAMPTZ;

DO $$
DECLARE
  v_losers INT;
  v_superseded INT;
  v_orphans INT;
BEGIN
  -- One row per (BVN, person): the person's first verification decides who was earliest.
  CREATE TEMP TABLE kyc_people ON COMMIT DROP AS
  SELECT bvn_hmac, user_id,
         row_number() OVER (PARTITION BY bvn_hmac ORDER BY first_at NULLS LAST, user_id) AS rn
  FROM (
    SELECT k.bvn_hmac, k.user_id, min(k.verified_at) AS first_at
    FROM public.kyc_verifications k
    WHERE k.status = 'verified' AND k.level = 2 AND k.bvn_hmac IS NOT NULL AND k.superseded_at IS NULL
    GROUP BY 1, 2
  ) p;

  CREATE TEMP TABLE kyc_loser_rows ON COMMIT DROP AS
  SELECT k.id, k.user_id
  FROM public.kyc_verifications k
  JOIN kyc_people p ON p.bvn_hmac = k.bvn_hmac AND p.user_id = k.user_id AND p.rn > 1
  WHERE k.status = 'verified' AND k.level = 2 AND k.superseded_at IS NULL;

  -- Older records of the same person and BVN (newest stays active).
  CREATE TEMP TABLE kyc_superseded_rows ON COMMIT DROP AS
  SELECT id FROM (
    SELECT k.id,
           row_number() OVER (PARTITION BY k.user_id, k.bvn_hmac ORDER BY k.verified_at DESC NULLS LAST, k.created_at DESC) AS rn
    FROM public.kyc_verifications k
    WHERE k.status = 'verified' AND k.level = 2 AND k.bvn_hmac IS NOT NULL AND k.superseded_at IS NULL
      AND k.id NOT IN (SELECT id FROM kyc_loser_rows)
  ) s WHERE rn > 1;

  SELECT count(DISTINCT user_id) INTO v_losers FROM kyc_loser_rows;
  SELECT count(*) INTO v_superseded FROM kyc_superseded_rows;
  SELECT count(*) INTO v_orphans FROM public.users u
  WHERE u.kyc_level = 2 AND u.email NOT LIKE '%@doings.internal'
    AND NOT EXISTS (SELECT 1 FROM public.kyc_verifications k
                    WHERE k.user_id = u.id AND k.status = 'verified' AND k.level = 2);

  -- Must equal the approved report; anything else means the data moved since approval.
  IF v_losers <> 1 OR v_superseded <> 1 OR v_orphans <> 0 THEN
    RAISE EXCEPTION 'Duplicate set changed since the report (losers %, superseded %, orphans %). Re-run the report.',
      v_losers, v_superseded, v_orphans;
  END IF;

  UPDATE public.kyc_verifications SET superseded_at = now()
  WHERE id IN (SELECT id FROM kyc_superseded_rows);

  -- Readable reason: tr_notify_kyc_status shows it to the user.
  UPDATE public.kyc_verifications
  SET status = 'rejected',
      rejection_reason = 'This BVN is already linked to another Doings account. Contact support.',
      reviewed_at = now()
  WHERE id IN (SELECT id FROM kyc_loser_rows);

  -- update_user_kyc_level only ever raises the level, so lower it directly.
  UPDATE public.users u SET kyc_level = 1, updated_at = now()
  WHERE u.id IN (SELECT user_id FROM kyc_loser_rows)
    AND u.kyc_level = 2
    AND NOT EXISTS (SELECT 1 FROM public.kyc_verifications k
                    WHERE k.user_id = u.id AND k.status = 'verified' AND k.level = 2);
END $$;

CREATE UNIQUE INDEX IF NOT EXISTS uq_kyc_verified_l2_bvn_hmac
  ON public.kyc_verifications (bvn_hmac)
  WHERE status = 'verified' AND level = 2 AND superseded_at IS NULL;
