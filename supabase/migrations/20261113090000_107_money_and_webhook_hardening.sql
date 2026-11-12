-- 107: security release 2 (audit of 2026-11-12): PIN change counts wrong guesses, the admin "refund" is
-- off, stored webhook secrets and unverified payloads are scrubbed, the send limit is enforced under a
-- lock, and an automatic FX rate that jumps is refused.
--
-- RELEASE ORDER:
--   1. the app that calls change_transaction_pin (it falls back to set_transaction_pin until 3);
--   2. the five webhook-* functions (they need nothing from this file). They must be live BEFORE the
--      scrub in section 3 runs, or the old ones go on writing the secret into new rows;
--   3. this migration;
--   4. the remaining functions (transfer needs internal_transfer_checked);
--   5. rotate the Flutterwave webhook hash.
--
-- BEFORE APPLYING: update_fx_market_rate is re-created from 047 with the band added; diff it against
--   pg_get_functiondef('public.update_fx_market_rate(bigint,text,jsonb)'::regprocedure)

-- ── 1. Changing the PIN ────────────────────────────────────────────────────────────────────────
-- set_transaction_pin raised on a wrong current PIN, which rolled back any count of the attempt, so a
-- session could try all 10,000 and then set its own. change_transaction_pin RETURNS a status instead, so
-- a wrong guess is kept and the same 5-attempt, 15-minute lock as paying applies.
CREATE FUNCTION public.change_transaction_pin(p_pin text, p_current_pin text)
RETURNS text
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, extensions
AS $$
DECLARE
  _user_id uuid;
  _hash text;
  _attempts smallint;
  _locked_until timestamptz;
BEGIN
  IF p_pin IS NULL OR p_pin !~ '^[0-9]{4}$' THEN
    RETURN 'PIN_FORMAT';
  END IF;

  _user_id := public.ensure_auth_user_profile();

  SELECT transaction_pin_hash, transaction_pin_failed_attempts, transaction_pin_locked_until
  INTO _hash, _attempts, _locked_until
  FROM public.users
  WHERE id = _user_id
  FOR UPDATE;

  IF _hash IS NULL THEN
    RETURN 'PIN_NOT_SET';
  END IF;
  IF _locked_until IS NOT NULL AND _locked_until > now() THEN
    RETURN 'PIN_LOCKED';
  END IF;

  IF p_current_pin IS NULL OR p_current_pin !~ '^[0-9]{4}$' OR crypt(p_current_pin, _hash) <> _hash THEN
    -- A lock that has expired starts a fresh window of 5 attempts (as check_transaction_pin).
    _attempts := CASE
      WHEN _locked_until IS NOT NULL AND _locked_until <= now() THEN 1
      ELSE COALESCE(_attempts, 0) + 1
    END;
    UPDATE public.users
    SET transaction_pin_failed_attempts = _attempts,
        transaction_pin_locked_until = CASE WHEN _attempts >= 5 THEN now() + interval '15 minutes' ELSE NULL END,
        updated_at = now()
    WHERE id = _user_id;
    RETURN CASE WHEN _attempts >= 5 THEN 'PIN_LOCKED' ELSE 'INVALID_PIN' END;
  END IF;

  UPDATE public.users
  SET transaction_pin_hash = crypt(p_pin, gen_salt('bf')),
      transaction_pin_set_at = now(),
      transaction_pin_failed_attempts = 0,
      transaction_pin_locked_until = NULL,
      updated_at = now()
  WHERE id = _user_id;
  RETURN 'OK';
END;
$$;
REVOKE ALL ON FUNCTION public.change_transaction_pin(text, text) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.change_transaction_pin(text, text) TO authenticated, service_role;

-- set_transaction_pin now only sets a first PIN. (It cannot count a wrong guess: its contract is to raise.)
CREATE OR REPLACE FUNCTION public.set_transaction_pin(
  p_pin text,
  p_current_pin text DEFAULT NULL
)
RETURNS void
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, extensions
AS $$
DECLARE
  _user_id uuid;
  _existing_hash text;
BEGIN
  IF p_pin IS NULL OR p_pin !~ '^[0-9]{4}$' THEN
    RAISE EXCEPTION 'PIN must be exactly 4 digits';
  END IF;

  _user_id := public.ensure_auth_user_profile();

  SELECT transaction_pin_hash INTO _existing_hash
  FROM public.users
  WHERE id = _user_id
  FOR UPDATE;

  IF _existing_hash IS NOT NULL THEN
    RAISE EXCEPTION 'Update the app to change your transaction PIN';
  END IF;

  UPDATE public.users
  SET transaction_pin_hash = crypt(p_pin, gen_salt('bf')),
      transaction_pin_set_at = now(),
      transaction_pin_failed_attempts = 0,
      transaction_pin_locked_until = NULL,
      updated_at = now()
  WHERE id = _user_id;
END;
$$;

-- ── 2. The admin "refund" is off ───────────────────────────────────────────────────────────────
-- It only accepted credits (deposits, giveaway claims) and credited the same wallet again: it doubled
-- money instead of returning it. Bundle orders and payouts have their own, correct, refund paths (096).
CREATE OR REPLACE FUNCTION public.admin_refund_transaction(
  p_transaction_id UUID,
  p_admin_auth_id UUID,
  p_reason TEXT DEFAULT 'Admin refund'
)
RETURNS UUID
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
BEGIN
  RAISE EXCEPTION 'Transaction refunds are switched off';
END;
$$;

-- ── 3. Webhook log: no stored secrets, nothing unverified to replay ────────────────────────────
-- Request headers were stored whole; Flutterwave's verif-hash header IS the shared secret. From now on
-- the functions keep three harmless headers and no signature. Rotate the Flutterwave hash after this.
UPDATE public.webhook_logs
SET headers = COALESCE(
      (SELECT jsonb_object_agg(k, v)
       FROM jsonb_each(CASE WHEN jsonb_typeof(headers) = 'object' THEN headers ELSE '{}'::jsonb END) AS h(k, v)
       WHERE k IN ('content-type', 'user-agent', 'x-forwarded-for')),
      '{}'::jsonb),
    signature = NULL;
-- A request that failed verification is anyone's text: keep that it happened, not what it said.
UPDATE public.webhook_logs
SET payload = '{"unverified": true}'::jsonb,
    idempotency_key = NULL,
    event_type = left(event_type, 80)
WHERE signature_valid IS DISTINCT FROM true;

-- ── 4. Sending bundles: the daily limit holds under concurrent requests ────────────────────────
-- The limit was read in the function and the debit made in a second step, so parallel sends each saw
-- the same "spent today". One sender's sends now run one at a time and are counted inside the lock.
CREATE FUNCTION public.internal_transfer_checked(
  p_sender_wallet_id UUID,
  p_receiver_wallet_id UUID,
  p_sender_user_id UUID,
  p_receiver_user_id UUID,
  p_amount BIGINT,
  p_description TEXT,
  p_daily_limit BIGINT
)
RETURNS UUID
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_currency public.currency;
  v_spent BIGINT;
BEGIN
  IF p_amount IS NULL OR p_amount <= 0 THEN
    RAISE EXCEPTION 'Transfer amount must be positive';
  END IF;

  PERFORM pg_advisory_xact_lock(hashtext('send:' || p_sender_user_id::text));

  SELECT currency INTO v_currency FROM public.wallets
  WHERE id = p_sender_wallet_id AND user_id = p_sender_user_id;
  IF NOT FOUND THEN
    RAISE EXCEPTION 'Sender wallet not found';
  END IF;
  IF NOT EXISTS (SELECT 1 FROM public.wallets
                 WHERE id = p_receiver_wallet_id AND user_id = p_receiver_user_id AND currency = v_currency) THEN
    RAISE EXCEPTION 'Receiver wallet not found';
  END IF;

  -- Same window and statuses as the function's pre-check (limits.ts): today, UTC.
  SELECT COALESCE(sum(abs(amount)), 0) INTO v_spent
  FROM public.transactions
  WHERE user_id = p_sender_user_id AND currency = v_currency AND type = 'send'
    AND status IN ('completed', 'pending', 'processing')
    AND created_at >= date_trunc('day', now() AT TIME ZONE 'UTC') AT TIME ZONE 'UTC';

  IF v_spent + p_amount > COALESCE(p_daily_limit, 0) THEN
    RAISE EXCEPTION 'DAILY_TRANSFER_LIMIT';
  END IF;

  RETURN public.internal_transfer(
    p_sender_wallet_id, p_receiver_wallet_id, p_sender_user_id, p_receiver_user_id,
    p_amount, 0::bigint, COALESCE(p_description, 'Internal transfer'), 'send'::public.transaction_type
  );
END;
$$;
REVOKE ALL ON FUNCTION public.internal_transfer_checked(uuid, uuid, uuid, uuid, bigint, text, bigint) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.internal_transfer_checked(uuid, uuid, uuid, uuid, bigint, text, bigint) TO service_role;

-- ── 5. FX: an automatic rate that jumps is not accepted ────────────────────────────────────────
-- The automatic rate is the median of public P2P adverts, so a thin or rigged board could move it, and
-- any signed-in person can trigger a refresh. A new automatic rate more than 15% away from the last
-- accepted one (35% when that one is over a day old) is recorded as rejected and not used. The stored
-- rate then goes stale and conversions stop by themselves (30-minute guard) until the next sane rate or
-- a manual one. A manual rate (finance, audited) is never refused here.
CREATE OR REPLACE FUNCTION public.update_fx_market_rate(
  p_market_rate_kobo bigint,
  p_source text,
  p_raw_payload jsonb DEFAULT NULL
)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_sell BIGINT;
  v_buy BIGINT;
  v_last BIGINT;
  v_last_at TIMESTAMPTZ;
  v_band NUMERIC;
BEGIN
  IF p_market_rate_kobo IS NULL OR p_market_rate_kobo <= 0 THEN
    RAISE EXCEPTION 'Invalid market rate';
  END IF;

  SELECT
    public.fx_compute_sell_rate_kobo(p_market_rate_kobo, fx_sell_flat_kobo, fx_sell_percent),
    public.fx_compute_buy_rate_kobo(p_market_rate_kobo, fx_buy_flat_kobo, fx_buy_percent),
    fx_market_rate_kobo, fx_market_rate_updated_at
  INTO v_sell, v_buy, v_last, v_last_at
  FROM public.platform_settings
  WHERE id = 1;

  -- 107: the sanity band (automatic sources only).
  IF COALESCE(p_source, '') <> 'manual' AND v_last IS NOT NULL AND v_last > 0 THEN
    v_band := CASE WHEN v_last_at IS NOT NULL AND v_last_at > now() - interval '24 hours' THEN 0.15 ELSE 0.35 END;
    IF abs(p_market_rate_kobo - v_last)::numeric / v_last > v_band THEN
      -- One record per 5 minutes is enough; the functions use it to pause re-fetching (fx/refused.ts).
      IF NOT EXISTS (SELECT 1 FROM public.fx_rate_snapshots
                     WHERE source LIKE '%:rejected' AND created_at > now() - interval '5 minutes') THEN
        INSERT INTO public.fx_rate_snapshots (source, market_rate_kobo, sell_rate_kobo, buy_rate_kobo, raw_payload)
        VALUES (left(COALESCE(p_source, 'unknown') || ':rejected', 100), p_market_rate_kobo, GREATEST(v_sell, 1), GREATEST(v_buy, 1), p_raw_payload);
      END IF;
      -- Same shape as an accepted update, describing the rate still in force.
      SELECT public.fx_compute_sell_rate_kobo(v_last, fx_sell_flat_kobo, fx_sell_percent),
             public.fx_compute_buy_rate_kobo(v_last, fx_buy_flat_kobo, fx_buy_percent)
      INTO v_sell, v_buy FROM public.platform_settings WHERE id = 1;
      RETURN jsonb_build_object('rejected', true, 'offered_rate_kobo', p_market_rate_kobo,
        'market_rate_kobo', v_last, 'sell_rate_kobo', v_sell, 'buy_rate_kobo', v_buy);
    END IF;
  END IF;

  UPDATE public.platform_settings
  SET fx_market_rate_kobo = p_market_rate_kobo,
      fx_market_rate_updated_at = now()
  WHERE id = 1;

  INSERT INTO public.fx_rate_snapshots (source, market_rate_kobo, sell_rate_kobo, buy_rate_kobo, raw_payload)
  VALUES (p_source, p_market_rate_kobo, v_sell, v_buy, p_raw_payload);

  RETURN jsonb_build_object(
    'market_rate_kobo', p_market_rate_kobo,
    'sell_rate_kobo', v_sell,
    'buy_rate_kobo', v_buy
  );
END;
$$;

-- ── 6. Rate-limit rows are cleared ─────────────────────────────────────────────────────────────
-- consume_rate_limit only clears a key's old rows when that key is used again, and every limiter now
-- counts in this table. Two days is longer than the longest window (the admin KYC view reads recent hits).
DO $$
BEGIN
  IF EXISTS (SELECT 1 FROM pg_extension WHERE extname = 'pg_cron') THEN
    PERFORM cron.unschedule(jobid) FROM cron.job WHERE jobname = 'rate-limit-cleanup';
    PERFORM cron.schedule('rate-limit-cleanup', '23 * * * *',
      $job$DELETE FROM public.rate_limit_hits WHERE hit_at < now() - interval '2 days'$job$);
  END IF;
END $$;
