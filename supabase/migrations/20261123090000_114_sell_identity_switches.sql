-- 114: what a person must do before selling bundles follows two admin switches.
--
-- Selling bundles back is the one point where Doings asks who someone is. Until now that was fixed:
-- BVN and a selfie, both, always (kyc_level 2). The owner wants each check on its own switch:
--
--   sell_requires_bvn     BVN lookup. With it ON, payouts only go to a bank account in the BVN name.
--                         With it OFF there is no verified name, so payouts go to ANY account the
--                         seller gives (owner decision, 2026-11-19).
--   sell_requires_selfie  A live selfie. With BVN on, it is also matched to the BVN photo.
--
-- Both ship ON, so nothing changes until an admin changes them (Payment Rails, super admins).
--
-- What a person has done is read from their verified, current KYC records:
--   BVN + selfie record (method bvn_selfie, level 2)   has BVN, has selfie
--   BVN record          (method bvn,        level 2)   has BVN               -- new
--   selfie record       (method selfie,     level 1)   has selfie            -- new; a selfie alone does
--                                                       not say who someone is, so it is not level 2
--   level 2 from before this migration                  has BVN, has selfie (they sold before; they still do)
--
-- BEFORE APPLYING: create_bundle_sale is re-created from the live definition; diff it against
--   pg_get_functiondef on the live function. Needs 113 (gifting_settings_json).

ALTER TABLE public.platform_settings
  ADD COLUMN IF NOT EXISTS sell_requires_bvn BOOLEAN NOT NULL DEFAULT true,
  ADD COLUMN IF NOT EXISTS sell_requires_selfie BOOLEAN NOT NULL DEFAULT true;

ALTER TABLE public.kyc_verifications DROP CONSTRAINT IF EXISTS kyc_verifications_method_check;
ALTER TABLE public.kyc_verifications ADD CONSTRAINT kyc_verifications_method_check
  CHECK (verification_method IS NULL OR verification_method IN ('bvn_nin', 'bvn_selfie', 'bvn', 'selfie'));

-- One place that answers "may this person sell, and if not, what is missing".
CREATE OR REPLACE FUNCTION public.sell_identity_status(p_user_id uuid)
RETURNS jsonb
LANGUAGE plpgsql
STABLE
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_level smallint;
  v_needs_bvn boolean;
  v_needs_selfie boolean;
  v_has_bvn boolean;
  v_has_selfie boolean;
BEGIN
  SELECT kyc_level INTO v_level FROM public.users WHERE id = p_user_id;
  -- A missing settings row fails closed: both checks required.
  SELECT COALESCE(max(sell_requires_bvn::int), 1) = 1, COALESCE(max(sell_requires_selfie::int), 1) = 1
    INTO v_needs_bvn, v_needs_selfie FROM public.platform_settings WHERE id = 1;

  v_has_bvn := COALESCE(v_level, 0) >= 2;
  v_has_selfie := EXISTS (
      SELECT 1 FROM public.kyc_verifications k
       WHERE k.user_id = p_user_id AND k.status = 'verified' AND k.superseded_at IS NULL
         AND k.liveness_score IS NOT NULL)
    -- Level 2 reached before BVN-only records existed was BVN + selfie (or the older BVN + NIN);
    -- those people sold before this migration and still do.
    OR (COALESCE(v_level, 0) >= 2 AND NOT EXISTS (
      SELECT 1 FROM public.kyc_verifications k
       WHERE k.user_id = p_user_id AND k.status = 'verified' AND k.superseded_at IS NULL
         AND k.verification_method = 'bvn'));

  RETURN jsonb_build_object(
    'needs_bvn', v_needs_bvn, 'needs_selfie', v_needs_selfie,
    'has_bvn', v_has_bvn, 'has_selfie', v_has_selfie,
    'ok', COALESCE(v_level, 0) >= 1
          AND (NOT v_needs_bvn OR v_has_bvn)
          AND (NOT v_needs_selfie OR v_has_selfie));
END;
$$;
REVOKE ALL ON FUNCTION public.sell_identity_status(uuid) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.sell_identity_status(uuid) TO service_role;

-- The signed-in person's own status, for the app's sell screen.
CREATE OR REPLACE FUNCTION public.my_sell_identity_status()
RETURNS jsonb
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path = public
AS $$
  SELECT public.sell_identity_status((SELECT id FROM public.users WHERE auth_id = auth.uid()))
$$;
REVOKE ALL ON FUNCTION public.my_sell_identity_status() FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.my_sell_identity_status() TO authenticated;

-- Admins read the two switches with the other gifting settings (113).
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
    'giveaway_l2_kobo', giveaway_daily_limit_l2_kobo,
    'sell_requires_bvn', sell_requires_bvn,
    'sell_requires_selfie', sell_requires_selfie)
  FROM public.platform_settings WHERE id = 1
$$;
REVOKE ALL ON FUNCTION public.gifting_settings_json() FROM PUBLIC, anon, authenticated;

CREATE OR REPLACE FUNCTION public.set_sell_identity_settings(_requires_bvn boolean, _requires_selfie boolean)
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
    RAISE EXCEPTION 'Only super admins can change selling checks';
  END IF;
  IF _requires_bvn IS NULL OR _requires_selfie IS NULL THEN RAISE EXCEPTION 'Both switches are required'; END IF;

  SELECT jsonb_build_object('sell_requires_bvn', sell_requires_bvn, 'sell_requires_selfie', sell_requires_selfie)
    INTO _before FROM public.platform_settings WHERE id = 1 FOR UPDATE;

  UPDATE public.platform_settings
     SET sell_requires_bvn = _requires_bvn, sell_requires_selfie = _requires_selfie,
         updated_at = now(), updated_by = _admin_id
   WHERE id = 1;

  PERFORM public.log_admin_action(_admin_id, 'set_sell_identity_settings', 'platform_settings', NULL,
    jsonb_build_object('sell_requires_bvn', _requires_bvn, 'sell_requires_selfie', _requires_selfie, 'before', _before));
END;
$$;
REVOKE ALL ON FUNCTION public.set_sell_identity_settings(boolean, boolean) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.set_sell_identity_settings(boolean, boolean) TO authenticated;

-- The sale itself: the fixed "level 2" test becomes the status above. Nothing else changes.
CREATE OR REPLACE FUNCTION public.create_bundle_sale(p_user_id uuid, p_bundles bigint, p_currency text, p_destination jsonb, p_idempotency_key text)
 RETURNS jsonb
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $$
DECLARE
  v_s public.platform_settings%ROWTYPE;
  v_existing public.transactions%ROWTYPE;
  v_kyc SMALLINT;
  v_ngn UUID;
  v_value BIGINT;
  v_fee BIGINT;
  v_rate BIGINT;
  v_usdc BIGINT;
  v_net_fee BIGINT;
  v_t_usdc UUID := public.get_treasury_wallet_id('USDC');
  v_t_avail BIGINT;
  v_txn UUID;
BEGIN
  IF p_idempotency_key IS NULL OR length(p_idempotency_key) < 8 THEN
    RAISE EXCEPTION 'Missing idempotency key';
  END IF;
  PERFORM pg_advisory_xact_lock(hashtext('bundle-sale:' || p_user_id::text));

  SELECT * INTO v_existing FROM public.transactions
    WHERE idempotency_key = p_idempotency_key AND user_id = p_user_id;
  IF FOUND THEN
    RETURN jsonb_build_object('transaction_id', v_existing.id, 'reference', p_idempotency_key,
      'status', v_existing.status, 'already', true,
      'currency', CASE WHEN v_existing.metadata->>'kind' = 'bundle_sale_usdc' THEN 'USDC' ELSE 'NGN' END,
      'bundles', (v_existing.metadata->>'bundles')::BIGINT, 'fee_kobo', v_existing.fee,
      'payout_kobo', CASE WHEN v_existing.metadata->>'kind' = 'bundle_sale_usdc' THEN NULL ELSE ABS(v_existing.amount) END,
      'usdc_micro', (v_existing.metadata->>'usdc_micro')::BIGINT);
  END IF;

  SELECT kyc_level INTO v_kyc FROM public.users WHERE id = p_user_id;
  IF COALESCE(v_kyc, 0) < 1 THEN
    RAISE EXCEPTION 'Verify your email to sell bundles';
  END IF;
  -- What else is needed follows the two admin switches (114).
  IF NOT COALESCE((public.sell_identity_status(p_user_id)->>'ok')::boolean, false) THEN
    RAISE EXCEPTION 'Complete identity verification to sell bundles';
  END IF;
  IF p_currency NOT IN ('NGN', 'USDC') THEN
    RAISE EXCEPTION 'currency must be NGN or USDC';
  END IF;

  SELECT * INTO v_s FROM public.platform_settings LIMIT 1;
  IF p_bundles IS NULL OR p_bundles < v_s.bundle_sell_min THEN
    RAISE EXCEPTION '%', format('Minimum sale is %s bundles', to_char(v_s.bundle_sell_min, 'FM999,999,999,999'));
  END IF;

  v_value := p_bundles * v_s.bundle_price_kobo;
  v_fee := v_s.bundle_sell_fee_flat_kobo + FLOOR(v_value * v_s.bundle_sell_fee_percent / 100);
  IF v_value <= v_fee THEN
    RAISE EXCEPTION 'Sale does not cover the fee';
  END IF;

  IF public.bundle_sale_daily_used_kobo(p_user_id) + v_value > v_s.withdrawal_daily_limit_l2_kobo THEN
    RAISE EXCEPTION 'Daily limit reached for selling bundles';
  END IF;

  SELECT id INTO v_ngn FROM public.wallets WHERE user_id = p_user_id AND currency = 'NGN';
  IF v_ngn IS NULL THEN
    RAISE EXCEPTION 'NGN wallet not found';
  END IF;

  IF p_currency = 'NGN' THEN
    IF NOT (p_destination ? 'account_number') THEN
      RAISE EXCEPTION 'Bank account required';
    END IF;
    v_txn := public.lock_withdrawal(v_ngn, p_user_id, v_value - v_fee, v_fee, 'withdrawal',
      format('Sold %s bundles', p_bundles), v_s.disbursement_provider_id, NULL, p_idempotency_key,
      jsonb_build_object('kind', 'bundle_sale', 'bundles', p_bundles, 'payout_currency', 'NGN',
        'bank', p_destination, 'reference', p_idempotency_key));
    IF (SELECT user_id FROM public.transactions WHERE id = v_txn) <> p_user_id THEN
      RAISE EXCEPTION 'Idempotency key already used';
    END IF;
    RETURN jsonb_build_object('transaction_id', v_txn, 'reference', p_idempotency_key, 'status', 'pending',
      'currency', 'NGN', 'bundles', p_bundles, 'fee_kobo', v_fee, 'payout_kobo', v_value - v_fee);
  END IF;

  -- USDC
  IF NOT v_s.bundle_sell_usdc_enabled THEN
    RAISE EXCEPTION 'USDC payouts are paused';
  END IF;
  IF NOT (p_destination ? 'address') THEN
    RAISE EXCEPTION 'Enter a valid Solana USDC address';
  END IF;
  IF v_s.fx_market_rate_kobo IS NULL OR v_s.fx_market_rate_kobo <= 0
     OR (v_s.fx_rate_source <> 'manual'
         AND (v_s.fx_market_rate_updated_at IS NULL OR v_s.fx_market_rate_updated_at < now() - interval '30 minutes')) THEN
    RAISE EXCEPTION 'Rate stale. Try again shortly.';
  END IF;

  v_rate := public.fx_compute_buy_rate_kobo(v_s.fx_market_rate_kobo, v_s.fx_buy_flat_kobo, v_s.fx_buy_percent);
  v_net_fee := v_s.bundle_sell_usdc_network_fee_micro;
  v_usdc := FLOOR((v_value - v_fee)::NUMERIC * 1000000 / v_rate) - v_net_fee;
  IF v_usdc < v_s.bundle_sell_usdc_min_micro THEN
    RAISE EXCEPTION '%', format('You need to sell more to receive at least %s USDC',
      trim_scale(v_s.bundle_sell_usdc_min_micro / 1000000.0));
  END IF;

  SELECT balance - locked_balance INTO v_t_avail FROM public.wallets WHERE id = v_t_usdc FOR UPDATE;
  IF COALESCE(v_t_avail, 0) < v_usdc + v_net_fee THEN
    RAISE EXCEPTION 'USDC payouts are temporarily unavailable';
  END IF;
  UPDATE public.wallets SET locked_balance = locked_balance + v_usdc + v_net_fee, updated_at = now()
    WHERE id = v_t_usdc;

  v_txn := public.lock_withdrawal(v_ngn, p_user_id, v_value - v_fee, v_fee, 'withdrawal',
    format('Sold %s bundles for USDC', p_bundles), 'blockradar', NULL, p_idempotency_key,
    jsonb_build_object('kind', 'bundle_sale_usdc', 'bundles', p_bundles, 'payout_currency', 'USDC',
      'usdc_micro', v_usdc, 'network_fee_micro', v_net_fee, 'rate_kobo', v_rate,
      'address', p_destination->>'address', 'reference', p_idempotency_key));
  IF (SELECT user_id FROM public.transactions WHERE id = v_txn) <> p_user_id THEN
      RAISE EXCEPTION 'Idempotency key already used';
    END IF;
  RETURN jsonb_build_object('transaction_id', v_txn, 'reference', p_idempotency_key, 'status', 'pending',
    'currency', 'USDC', 'bundles', p_bundles, 'fee_kobo', v_fee, 'usdc_micro', v_usdc,
    'network_fee_micro', v_net_fee, 'rate_kobo', v_rate);
END;
$$;

-- Grants are unchanged by CREATE OR REPLACE (service_role only).
