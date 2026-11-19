-- 113: gifting settings (security release 3, part B, and the gifting launch).
--
-- Doings launches as a gifting product: people buy bundles, share them, give them away and spray
-- them with only a verified email. BVN and selfie are asked for at one point only, when someone
-- sells bundles back for cash. Sharing and giveaways have a daily allowance; sprays do not (yet).
--
-- 1. Sharing (the transfer function). share_requires_identity ships FALSE: a verified email is
--    enough to share. Switched TRUE from the admin, sharing needs BVN + selfie again, as before.
--      email-only   N200,000 a day    share_daily_limit_l1_kobo
--      verified     N5,000,000 a day  share_daily_limit_l2_kobo  (was fixed in limits.ts)
--    The transfer function reads these and hands the limit to internal_transfer_checked, which
--    enforces it under a lock, as before.
--
-- 2. Giveaways sat outside every limit: any amount could be moved through them. They now have a
--    daily allowance by verification level:
--      email-only   N200,000 a day    giveaway_daily_limit_l1_kobo
--      verified     N5,000,000 a day  giveaway_daily_limit_l2_kobo
--
-- Selling is untouched: create_bundle_sale and the sell function still require level 2.
--
-- BEFORE APPLYING: create_giveaway_funded is re-created from 064; diff it against
--   pg_get_functiondef on the live function.

ALTER TABLE public.platform_settings
  ADD COLUMN IF NOT EXISTS share_requires_identity BOOLEAN NOT NULL DEFAULT false,
  ADD COLUMN IF NOT EXISTS share_daily_limit_l1_kobo BIGINT NOT NULL DEFAULT 20000000
    CHECK (share_daily_limit_l1_kobo >= 0),
  ADD COLUMN IF NOT EXISTS share_daily_limit_l2_kobo BIGINT NOT NULL DEFAULT 500000000
    CHECK (share_daily_limit_l2_kobo >= 0);

ALTER TABLE public.platform_settings
  ADD COLUMN IF NOT EXISTS giveaway_daily_limit_l1_kobo BIGINT NOT NULL DEFAULT 20000000
    CHECK (giveaway_daily_limit_l1_kobo >= 0),
  ADD COLUMN IF NOT EXISTS giveaway_daily_limit_l2_kobo BIGINT NOT NULL DEFAULT 500000000
    CHECK (giveaway_daily_limit_l2_kobo >= 0);

CREATE OR REPLACE FUNCTION public.create_giveaway_funded(
  p_creator_id UUID,
  p_title TEXT,
  p_total_kobo BIGINT,
  p_per_person_kobo BIGINT,
  p_type public.giveaway_type,
  p_event_id UUID DEFAULT NULL,
  p_is_private BOOLEAN DEFAULT false,
  p_show_on_event_screen BOOLEAN DEFAULT true,
  p_idempotency_key TEXT DEFAULT NULL
)
RETURNS JSONB
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_wallet_id UUID;
  v_fund_txn_id UUID;
  v_giveaway public.giveaways%ROWTYPE;
  v_idem TEXT;
  v_limit BIGINT;
  v_used BIGINT;
BEGIN
  IF p_total_kobo < 10000 THEN
    RAISE EXCEPTION 'Minimum total is ₦100';
  END IF;
  IF p_per_person_kobo < 1000 THEN
    RAISE EXCEPTION 'Minimum per person is ₦10';
  END IF;
  IF p_per_person_kobo > p_total_kobo THEN
    RAISE EXCEPTION 'per_person_amount cannot exceed total_amount';
  END IF;
  IF p_total_kobo % p_per_person_kobo <> 0 THEN
    RAISE EXCEPTION 'total_amount must be evenly divisible by per_person_amount';
  END IF;

  IF p_event_id IS NOT NULL THEN
    IF p_type IS DISTINCT FROM 'live'::public.giveaway_type THEN
      RAISE EXCEPTION 'Event giveaways must be type live';
    END IF;

    IF NOT EXISTS (
      SELECT 1
      FROM public.events e
      WHERE e.id = p_event_id
        AND e.status = 'live'
        AND (
          e.host_id = p_creator_id
          OR EXISTS (
            SELECT 1
            FROM public.event_participants ep
            WHERE ep.event_id = e.id
              AND ep.user_id = p_creator_id
          )
        )
    ) THEN
      RAISE EXCEPTION 'Join this live event before dropping a giveaway on it';
    END IF;
  END IF;

  -- Locked, so two giveaways sent at the same moment are counted one after the other.
  SELECT id INTO v_wallet_id
  FROM public.wallets
  WHERE user_id = p_creator_id AND currency = 'NGN'
  FOR UPDATE;

  IF v_wallet_id IS NULL THEN
    RAISE EXCEPTION 'NGN wallet not found';
  END IF;

  -- Daily limit (113). Today is the UTC day, as for transfers. Every giveaway funded today counts in
  -- full, stopped ones too, so stop-and-recreate is not a way round it.
  SELECT CASE WHEN u.kyc_level >= 2 THEN s.giveaway_daily_limit_l2_kobo
              WHEN u.kyc_level = 1 THEN s.giveaway_daily_limit_l1_kobo
              ELSE 0 END
    INTO v_limit
    FROM public.users u CROSS JOIN public.platform_settings s
   WHERE u.id = p_creator_id AND s.id = 1;

  SELECT COALESCE(sum(total_amount), 0) INTO v_used
    FROM public.giveaways
   WHERE creator_id = p_creator_id
     AND created_at >= date_trunc('day', now() AT TIME ZONE 'UTC') AT TIME ZONE 'UTC';

  IF v_used + p_total_kobo > COALESCE(v_limit, 0) THEN
    -- The number is what is left today, in kobo; the giveaway function turns it into a sentence.
    RAISE EXCEPTION 'GIVEAWAY_DAILY_LIMIT %', GREATEST(COALESCE(v_limit, 0) - v_used, 0);
  END IF;

  v_idem := COALESCE(p_idempotency_key, 'giveaway-fund-' || gen_random_uuid()::text);

  v_fund_txn_id := public.debit_wallet(
    v_wallet_id,
    p_creator_id,
    p_total_kobo,
    0,
    'giveaway',
    'Giveaway funding: ' || p_title,
    'internal',
    v_idem,
    jsonb_build_object('title', p_title)
  );

  INSERT INTO public.giveaways (
    creator_id,
    title,
    total_amount,
    per_person_amount,
    remaining_amount,
    type,
    event_id,
    is_private,
    show_on_event_screen,
    funding_transaction_id
  ) VALUES (
    p_creator_id,
    p_title,
    p_total_kobo,
    p_per_person_kobo,
    p_total_kobo,
    p_type,
    p_event_id,
    COALESCE(p_is_private, false),
    COALESCE(p_show_on_event_screen, true),
    v_fund_txn_id
  )
  RETURNING * INTO v_giveaway;

  RETURN jsonb_build_object(
    'id', v_giveaway.id,
    'code', v_giveaway.code,
    'total_amount', v_giveaway.total_amount,
    'per_person_amount', v_giveaway.per_person_amount,
    'max_recipients', v_giveaway.max_recipients,
    'status', v_giveaway.status,
    'funding_transaction_id', v_fund_txn_id
  );
END;
$$;

-- Grants are unchanged by CREATE OR REPLACE (service_role only, from 076).

-- ── Gifting settings ──────────────────────────────────────────────────────────────────────────────
-- Read and set from the admin (Payment Rails page) by the signed-in admin, like the withdrawal fee
-- settings; has_admin_role also holds a super admin to the two-step rule.
CREATE OR REPLACE FUNCTION public.gifting_settings_json()
RETURNS jsonb
LANGUAGE sql
STABLE
SET search_path = public
AS $$
  SELECT jsonb_build_object(
    'share_requires_identity', share_requires_identity,
    'share_l1_kobo', share_daily_limit_l1_kobo,
    'share_l2_kobo', share_daily_limit_l2_kobo,
    'giveaway_l1_kobo', giveaway_daily_limit_l1_kobo,
    'giveaway_l2_kobo', giveaway_daily_limit_l2_kobo)
  FROM public.platform_settings WHERE id = 1
$$;
REVOKE ALL ON FUNCTION public.gifting_settings_json() FROM PUBLIC, anon, authenticated;

CREATE OR REPLACE FUNCTION public.get_gifting_settings()
RETURNS jsonb
LANGUAGE plpgsql
STABLE
SECURITY DEFINER
SET search_path = public
AS $$
BEGIN
  IF NOT EXISTS (SELECT 1 FROM public.admin_roles WHERE user_id = auth.uid() AND status = 'active') THEN
    RAISE EXCEPTION 'Only admins can read gifting settings';
  END IF;
  RETURN public.gifting_settings_json();
END;
$$;

CREATE OR REPLACE FUNCTION public.set_gifting_settings(
  _share_requires_identity boolean,
  _share_l1_kobo bigint,
  _share_l2_kobo bigint,
  _giveaway_l1_kobo bigint,
  _giveaway_l2_kobo bigint
)
RETURNS void
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  _admin_id uuid := auth.uid();
  _before jsonb;
BEGIN
  IF _admin_id IS NULL OR NOT public.has_admin_role(_admin_id, 'super_admin') THEN
    RAISE EXCEPTION 'Only super admins can change gifting settings';
  END IF;
  IF _share_requires_identity IS NULL OR _share_l1_kobo IS NULL OR _share_l2_kobo IS NULL
     OR _giveaway_l1_kobo IS NULL OR _giveaway_l2_kobo IS NULL THEN
    RAISE EXCEPTION 'Every setting is required';
  END IF;
  IF LEAST(_share_l1_kobo, _share_l2_kobo, _giveaway_l1_kobo, _giveaway_l2_kobo) < 0 THEN
    RAISE EXCEPTION 'A limit cannot be negative';
  END IF;
  IF _share_l2_kobo < _share_l1_kobo OR _giveaway_l2_kobo < _giveaway_l1_kobo THEN
    RAISE EXCEPTION 'A verified limit cannot be lower than the email-only limit';
  END IF;

  PERFORM 1 FROM public.platform_settings WHERE id = 1 FOR UPDATE;
  _before := public.gifting_settings_json();

  UPDATE public.platform_settings
     SET share_requires_identity = _share_requires_identity,
         share_daily_limit_l1_kobo = _share_l1_kobo, share_daily_limit_l2_kobo = _share_l2_kobo,
         giveaway_daily_limit_l1_kobo = _giveaway_l1_kobo, giveaway_daily_limit_l2_kobo = _giveaway_l2_kobo,
         updated_at = now(), updated_by = _admin_id
   WHERE id = 1;

  PERFORM public.log_admin_action(_admin_id, 'set_gifting_settings', 'platform_settings', NULL,
    public.gifting_settings_json() || jsonb_build_object('before', _before));
END;
$$;

-- The one thing the app needs to draw the right screen: does sharing ask for BVN + selfie right now?
-- The limits themselves are not given out; the transfer function enforces them.
CREATE OR REPLACE FUNCTION public.share_requires_identity()
RETURNS boolean
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path = public
AS $$
  SELECT COALESCE((SELECT share_requires_identity FROM public.platform_settings WHERE id = 1), true)
$$;

REVOKE ALL ON FUNCTION public.get_gifting_settings() FROM PUBLIC, anon;
REVOKE ALL ON FUNCTION public.set_gifting_settings(boolean, bigint, bigint, bigint, bigint) FROM PUBLIC, anon;
REVOKE ALL ON FUNCTION public.share_requires_identity() FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.get_gifting_settings() TO authenticated;
GRANT EXECUTE ON FUNCTION public.set_gifting_settings(boolean, bigint, bigint, bigint, bigint) TO authenticated;
GRANT EXECUTE ON FUNCTION public.share_requires_identity() TO authenticated, service_role;
