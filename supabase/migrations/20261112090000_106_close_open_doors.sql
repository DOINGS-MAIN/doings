-- 106: close the doors found by the 2026-11-12 security audit (release 1 of 3).
-- Access only: who may call or read what. No money logic changes except the giveaway claim rule in 6.
--
-- BEFORE APPLYING: two functions are re-created from their last definitions with a marked change each.
-- Diff each against the live definition first:
--   pg_get_functiondef('public.redeem_giveaway_code(uuid,text)'::regprocedure)      -- from 061, adds the event rule
--   pg_get_functiondef('public.get_event_screen_giveaways(uuid)'::regprocedure)     -- from 064, hides private ones
-- The three payment-rail setters (031, 033) are re-created with a stricter role check only.

-- ── 1. Functions only the server calls ─────────────────────────────────────────────────────────
-- verify_transaction_pin_internal took any user id and never kept a failed attempt (its raise rolled
-- the count back), so the public key could guess any PIN. Nothing calls it since 073.
-- create_notification inserted a notification for any user id.
DO $$
DECLARE f text;
BEGIN
  FOREACH f IN ARRAY ARRAY[
    'public.verify_transaction_pin_internal(uuid, text)',
    'public.create_notification(uuid, varchar, varchar, text, jsonb)',
    'public.refresh_leaderboards()',
    'public.fx_user_daily_volume_usdc_micro(uuid)',
    'public.get_treasury_wallet_id(public.currency)'
  ] LOOP
    EXECUTE format('REVOKE ALL ON FUNCTION %s FROM PUBLIC, anon, authenticated', f);
    EXECUTE format('GRANT EXECUTE ON FUNCTION %s TO service_role', f);
  END LOOP;
END $$;

-- ── 2. Functions for signed-in people only (they all key on auth.uid(); signed out they only leaked
--       settings or answered "is this id an admin") ──────────────────────────────────────────────
-- Left open to the public key on purpose: what the signed-out big screen and invite page call
-- (get_event_floor, get_event_top_gifters, get_event_screen_giveaways, get_event_live_spray_holds,
-- get_invite_preview, and get_event_spray_feed / get_event_spray_queue_holds, which return nothing signed out).
DO $$
DECLARE f text;
BEGIN
  FOREACH f IN ARRAY ARRAY[
    'public.has_admin_role(uuid, public.admin_role)',
    'public.is_any_admin(uuid)',
    'public.get_admin_role(uuid)',
    'public.ensure_auth_user_profile()',
    'public.has_transaction_pin()',
    'public.set_transaction_pin(text, text)',
    'public.is_username_available(text, uuid)',
    'public.set_username(text)',
    'public.get_wallet_funding_provider()',
    'public.get_disbursement_provider()',
    'public.get_platform_payment_settings()',
    'public.list_psp_providers()',
    'public.set_wallet_funding_provider(text)',
    'public.set_disbursement_provider(text)',
    'public.set_psp_env(text)',
    'public.get_withdrawal_fee_settings()',
    'public.set_withdrawal_fee_settings(numeric, bigint)',
    'public.get_fx_public_settings()',
    'public.get_fx_admin_settings()',
    'public.get_treasury_balances()',
    'public.record_treasury_topup(public.currency, bigint, text, text)',
    'public.set_fx_settings(boolean, text, bigint, numeric, bigint, numeric, numeric, numeric, bigint, bigint, integer)',
    'public.set_fx_market_rate_manual(numeric)',
    'public.get_spray_theatre_admin_settings()',
    'public.set_spray_theatre_settings(numeric, numeric, numeric, numeric, bigint, integer, integer, jsonb)',
    'public.set_spray_hold_paused(uuid, boolean)',
    'public.get_my_live_events_for_giveaway()'
  ] LOOP
    EXECUTE format('REVOKE ALL ON FUNCTION %s FROM PUBLIC, anon', f);
    EXECUTE format('GRANT EXECUTE ON FUNCTION %s TO authenticated, service_role', f);
  END LOOP;
END $$;

-- Every SECURITY DEFINER function runs with a fixed search_path (17 had none, the wallet primitives among them).
DO $$
DECLARE r record;
BEGIN
  FOR r IN
    SELECT p.oid::regprocedure AS fn FROM pg_proc p
    WHERE p.pronamespace = 'public'::regnamespace AND p.prosecdef
      AND NOT EXISTS (SELECT 1 FROM unnest(COALESCE(p.proconfig, '{}')) c WHERE c LIKE 'search_path=%')
  LOOP
    EXECUTE format('ALTER FUNCTION %s SET search_path = public, extensions', r.fn);
  END LOOP;
END $$;

-- ── 3. Leaderboards: no direct reads (they carried user ids and full names to the public key; a
--       materialized view cannot have row rules). Only the retired app read them. ──────────────────
REVOKE ALL ON public.leaderboard_alltime, public.leaderboard_monthly, public.leaderboard_weekly FROM PUBLIC, anon, authenticated;

-- ── 4. users: the PIN columns leave the API ────────────────────────────────────────────────────
-- A 4-digit PIN's hash is guessable offline in seconds, so its owner's session (and, before 5, every
-- admin) must not be able to read it. Writes stay as 074 / 105 left them.
REVOKE SELECT, INSERT, DELETE ON public.users FROM PUBLIC, anon, authenticated;
GRANT SELECT (
  id, auth_id, email, phone, username, full_name, avatar_url, avatar_data, gender, date_of_birth, address,
  kyc_level, status, suspended_at, suspended_by, suspended_reason, referral_code, referred_by,
  transaction_pin_set_at, last_active_at, created_at, updated_at
) ON public.users TO authenticated;

-- ── 5. events: hosts change the cover only; everything else goes through the events function ────
-- A host could set status, flags, totals and the code on their own row, undoing an admin's End or flag,
-- and anyone could insert a live event directly (skipping the suspended / banned check).
DROP POLICY IF EXISTS "Users can create events" ON public.events;
DROP POLICY IF EXISTS "Hosts can update own events" ON public.events;
CREATE POLICY "Hosts can update own events"
  ON public.events FOR UPDATE TO authenticated
  USING (host_id IN (SELECT id FROM public.users WHERE auth_id = auth.uid()))
  WITH CHECK (host_id IN (SELECT id FROM public.users WHERE auth_id = auth.uid()));
REVOKE INSERT, UPDATE, DELETE ON public.events FROM PUBLIC, anon, authenticated;
GRANT UPDATE (cover_url) ON public.events TO authenticated;

-- Signed out (the big screen): only what the screen shows. No host id, no flag fields.
REVOKE SELECT ON public.events FROM PUBLIC, anon;
GRANT SELECT (
  id, title, type, description, location, event_date, event_time, scheduled_at, event_code, status, is_private,
  max_participants, participant_count, total_sprayed, cover_url, started_at, ended_at, created_at
) ON public.events TO anon;

-- ── 6. Admins act through the admin function only ──────────────────────────────────────────────
-- These let any admin role read or change rows directly, outside the role matrix and the audit log
-- (change an event's host, read every user's row, add an admin). The admin function uses service_role.
DROP POLICY IF EXISTS "Admins can manage all events" ON public.events;
DROP POLICY IF EXISTS "Admins can view all users" ON public.users;
DROP POLICY IF EXISTS "Admins can update users" ON public.users;
DROP POLICY IF EXISTS "Admins can view all wallets" ON public.wallets;
DROP POLICY IF EXISTS "Admins can view all transactions" ON public.transactions;
DROP POLICY IF EXISTS "Admins can view all reserved accounts" ON public.reserved_accounts;
DROP POLICY IF EXISTS "Admins can view psp events" ON public.psp_events;
DROP POLICY IF EXISTS "Admins can view psp providers" ON public.psp_providers;
DROP POLICY IF EXISTS "Admins can view provider health" ON public.provider_health;
DROP POLICY IF EXISTS "Admins can view webhook logs" ON public.webhook_logs;
DROP POLICY IF EXISTS "Super admins can manage admin roles" ON public.admin_roles;

-- Switching live payments to sandbox or another provider is a super admin's call, not any admin's.
CREATE OR REPLACE FUNCTION public.set_psp_env(_psp_env text)
RETURNS void
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  _admin_id uuid := auth.uid();
BEGIN
  IF NOT public.has_admin_role(_admin_id, 'super_admin') THEN
    RAISE EXCEPTION 'Super admin access required';
  END IF;

  IF _psp_env NOT IN ('sandbox', 'production') THEN
    RAISE EXCEPTION 'Invalid PSP environment: %', _psp_env;
  END IF;

  UPDATE public.platform_settings
  SET psp_env = _psp_env,
      updated_at = now(),
      updated_by = _admin_id
  WHERE id = 1;

  PERFORM public.log_admin_action(
    _admin_id, 'set_psp_env', 'platform_settings', NULL,
    jsonb_build_object('psp_env', _psp_env)
  );
END;
$$;

CREATE OR REPLACE FUNCTION public.set_wallet_funding_provider(_provider_id text)
RETURNS void
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  _admin_id uuid := auth.uid();
BEGIN
  IF NOT public.has_admin_role(_admin_id, 'super_admin') THEN
    RAISE EXCEPTION 'Super admin access required';
  END IF;

  IF NOT EXISTS (
    SELECT 1 FROM public.psp_providers
    WHERE id = _provider_id
      AND status IN ('active', 'sandbox_only')
      AND 'wallet_funding' = ANY(capabilities)
  ) THEN
    RAISE EXCEPTION 'Invalid or unsupported wallet funding provider: %', _provider_id;
  END IF;

  UPDATE public.platform_settings
  SET wallet_funding_provider_id = _provider_id,
      updated_at = now(),
      updated_by = _admin_id
  WHERE id = 1;

  PERFORM public.log_admin_action(
    _admin_id, 'set_wallet_funding_provider', 'platform_settings', NULL,
    jsonb_build_object('provider_id', _provider_id)
  );
END;
$$;

CREATE OR REPLACE FUNCTION public.set_disbursement_provider(_provider_id text)
RETURNS void
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  _admin_id uuid := auth.uid();
BEGIN
  IF NOT public.has_admin_role(_admin_id, 'super_admin') THEN
    RAISE EXCEPTION 'Super admin access required';
  END IF;

  IF NOT EXISTS (
    SELECT 1 FROM public.psp_providers
    WHERE id = _provider_id
      AND status IN ('active', 'sandbox_only')
      AND 'disbursement' = ANY(capabilities)
  ) THEN
    RAISE EXCEPTION 'Invalid or unsupported disbursement provider: %', _provider_id;
  END IF;

  UPDATE public.platform_settings
  SET disbursement_provider_id = _provider_id,
      updated_at = now(),
      updated_by = _admin_id
  WHERE id = 1;

  PERFORM public.log_admin_action(
    _admin_id, 'set_disbursement_provider', 'platform_settings', NULL,
    jsonb_build_object('provider_id', _provider_id)
  );
END;
$$;

-- ── 7. Giveaways: codes are not listed to the internet; event giveaways are for the event's guests ──
-- The signed-out row policy handed every active on-screen giveaway (code included) to the public key and
-- to realtime. The screen reads its own event's giveaways through get_event_screen_giveaways.
DROP POLICY IF EXISTS "Anon can view event screen giveaways" ON public.giveaways;
-- Legacy projector policy (pending holds with wallet ids); the screen uses get_event_live_spray_holds.
DROP POLICY IF EXISTS "Anon can view spray holds on public live events" ON public.spray_holds;

-- One change to get_event_screen_giveaways: a private giveaway is never shown on the screen.
CREATE OR REPLACE FUNCTION public.get_event_screen_giveaways(p_event_id UUID)
RETURNS TABLE (
  id UUID,
  title TEXT,
  code TEXT,
  per_person_amount BIGINT,
  remaining_amount BIGINT,
  status public.giveaway_status,
  show_on_event_screen BOOLEAN
)
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path = public
AS $$
  SELECT
    g.id,
    g.title,
    g.code,
    g.per_person_amount,
    g.remaining_amount,
    g.status,
    g.show_on_event_screen
  FROM public.giveaways g
  JOIN public.events e ON e.id = g.event_id
  WHERE g.event_id = p_event_id
    AND g.status = 'active'
    AND g.show_on_event_screen = true
    AND COALESCE(g.is_private, false) = false
    AND e.status = 'live'
    AND (
      (e.is_private = false)
      OR e.host_id IN (SELECT u.id FROM public.users u WHERE u.auth_id = auth.uid())
    )
  ORDER BY g.created_at DESC;
$$;

-- One change to redeem_giveaway_code: a giveaway that belongs to an event is claimed by that event's
-- host or guests. Someone who is not a guest yet is joined by the claim when the event is public, live
-- and has room (the same conditions as joining by hand), so a scan at the party still claims in one step;
-- a private, ended or full event's giveaway is refused.
CREATE OR REPLACE FUNCTION public.redeem_giveaway_code(
  p_redeemer_id UUID,
  p_code TEXT
)
RETURNS JSONB
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_giveaway public.giveaways%ROWTYPE;
  v_event RECORD;
  v_recipient_wallet UUID;
  v_kyc SMALLINT;
  v_txn_id UUID;
  v_redemption_id UUID;
  v_idem TEXT;
BEGIN
  SELECT kyc_level INTO v_kyc FROM public.users WHERE id = p_redeemer_id;
  IF NOT FOUND THEN
    RAISE EXCEPTION 'User not found';
  END IF;
  IF v_kyc < 1 THEN
    RAISE EXCEPTION 'Verify your email to redeem giveaways';
  END IF;

  SELECT * INTO v_giveaway
  FROM public.giveaways
  WHERE code = upper(trim(p_code))
  FOR UPDATE;

  IF NOT FOUND THEN
    RAISE EXCEPTION 'Giveaway not found';
  END IF;
  IF v_giveaway.status <> 'active' THEN
    RAISE EXCEPTION 'Giveaway is no longer active';
  END IF;
  IF v_giveaway.creator_id = p_redeemer_id THEN
    RAISE EXCEPTION 'Cannot redeem your own giveaway';
  END IF;
  IF v_giveaway.remaining_amount < v_giveaway.per_person_amount THEN
    RAISE EXCEPTION 'Giveaway is exhausted';
  END IF;

  IF EXISTS (
    SELECT 1 FROM public.giveaway_redemptions
    WHERE giveaway_id = v_giveaway.id AND user_id = p_redeemer_id
  ) THEN
    RAISE EXCEPTION 'You have already redeemed this giveaway';
  END IF;

  -- 106: event giveaways are for the event's host and guests.
  IF v_giveaway.event_id IS NOT NULL THEN
    SELECT host_id, status, is_private, max_participants, participant_count INTO v_event
    FROM public.events WHERE id = v_giveaway.event_id;
    IF v_event.host_id <> p_redeemer_id AND NOT EXISTS (
      SELECT 1 FROM public.event_participants
      WHERE event_id = v_giveaway.event_id AND user_id = p_redeemer_id
    ) THEN
      IF v_event.status <> 'live' OR v_event.is_private
         OR (v_event.max_participants IS NOT NULL AND v_event.participant_count >= v_event.max_participants) THEN
        RAISE EXCEPTION 'Join the event to claim this giveaway';
      END IF;
      INSERT INTO public.event_participants (event_id, user_id, role)
      VALUES (v_giveaway.event_id, p_redeemer_id, 'guest')
      ON CONFLICT (event_id, user_id) DO NOTHING;
    END IF;
  END IF;

  SELECT id INTO v_recipient_wallet
  FROM public.wallets
  WHERE user_id = p_redeemer_id AND currency = 'NGN';

  IF v_recipient_wallet IS NULL THEN
    RAISE EXCEPTION 'Wallet not found';
  END IF;

  v_idem := 'giveaway-redeem-' || v_giveaway.id::text || '-' || p_redeemer_id::text;

  v_txn_id := public.credit_wallet(
    v_recipient_wallet,
    p_redeemer_id,
    v_giveaway.per_person_amount,
    0::bigint,
    'giveaway'::transaction_type,
    'Giveaway redemption: ' || v_giveaway.id::text,
    'internal',
    NULL,
    v_idem,
    jsonb_build_object('giveaway_id', v_giveaway.id)
  );

  INSERT INTO public.giveaway_redemptions (giveaway_id, user_id, amount, transaction_id)
  VALUES (v_giveaway.id, p_redeemer_id, v_giveaway.per_person_amount, v_txn_id)
  RETURNING id INTO v_redemption_id;

  RETURN jsonb_build_object(
    'amount', v_giveaway.per_person_amount,
    'transaction_id', v_txn_id,
    'redemption_id', v_redemption_id,
    'giveaway_id', v_giveaway.id
  );
END;
$$;

REVOKE ALL ON FUNCTION public.redeem_giveaway_code(uuid, text) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.redeem_giveaway_code(uuid, text) TO service_role;

-- ── 8. avatars bucket: only the server writes; nobody lists it ─────────────────────────────────
-- Avatar files are written by the streamoji function (service_role). The client policies let any
-- signed-in person host 30 MB files of any type under the project's storage address, and the read
-- policy let the public key list every folder (each one a user's auth id). Public URLs keep working:
-- a public bucket serves objects without a policy.
DROP POLICY IF EXISTS "Avatar photos are publicly readable" ON storage.objects;
DROP POLICY IF EXISTS "Users can upload own avatar photo" ON storage.objects;
DROP POLICY IF EXISTS "Users can update own avatar photo" ON storage.objects;
DROP POLICY IF EXISTS "Users can delete own avatar photo" ON storage.objects;

-- ── 9. Table privileges the API never needs ────────────────────────────────────────────────────
-- TRUNCATE is not covered by row-level security; the API has no way to call it today, and should not hold it.
REVOKE TRUNCATE, REFERENCES, TRIGGER ON ALL TABLES IN SCHEMA public FROM PUBLIC, anon, authenticated;
