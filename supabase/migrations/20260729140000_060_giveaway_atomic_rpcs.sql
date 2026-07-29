-- Atomic giveaway create / redeem / stop, plus projector giveaway feed.

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

  SELECT id INTO v_wallet_id
  FROM public.wallets
  WHERE user_id = p_creator_id AND currency = 'NGN';

  IF v_wallet_id IS NULL THEN
    RAISE EXCEPTION 'NGN wallet not found';
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
    0,
    'giveaway',
    'Giveaway redemption: ' || v_giveaway.id::text,
    'internal',
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

CREATE OR REPLACE FUNCTION public.stop_giveaway_funded(
  p_creator_id UUID,
  p_giveaway_id UUID
)
RETURNS JSONB
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_giveaway public.giveaways%ROWTYPE;
  v_wallet_id UUID;
  v_refund_txn_id UUID;
  v_refund BIGINT;
BEGIN
  SELECT * INTO v_giveaway
  FROM public.giveaways
  WHERE id = p_giveaway_id
  FOR UPDATE;

  IF NOT FOUND THEN
    RAISE EXCEPTION 'Giveaway not found';
  END IF;
  IF v_giveaway.creator_id <> p_creator_id THEN
    RAISE EXCEPTION 'Only the creator can stop a giveaway';
  END IF;
  IF v_giveaway.status <> 'active' THEN
    RAISE EXCEPTION 'Giveaway is not active';
  END IF;

  v_refund := v_giveaway.remaining_amount;

  IF v_refund > 0 THEN
    SELECT id INTO v_wallet_id
    FROM public.wallets
    WHERE user_id = p_creator_id AND currency = 'NGN';

    IF v_wallet_id IS NULL THEN
      RAISE EXCEPTION 'Creator wallet not found';
    END IF;

    v_refund_txn_id := public.credit_wallet(
      v_wallet_id,
      p_creator_id,
      v_refund,
      0,
      'giveaway_refund',
      'Giveaway refund: ' || v_giveaway.id::text,
      'internal',
      'giveaway-refund-' || v_giveaway.id::text,
      jsonb_build_object('giveaway_id', v_giveaway.id)
    );

    UPDATE public.giveaways
    SET status = 'stopped',
        remaining_amount = 0,
        refund_transaction_id = v_refund_txn_id,
        stopped_at = now()
    WHERE id = v_giveaway.id;
  ELSE
    UPDATE public.giveaways
    SET status = 'stopped',
        stopped_at = now()
    WHERE id = v_giveaway.id;
  END IF;

  RETURN jsonb_build_object(
    'refunded', v_refund,
    'refund_transaction_id', v_refund_txn_id
  );
END;
$$;

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
    AND e.status = 'live'
    AND (
      (e.is_private = false)
      OR e.host_id IN (SELECT u.id FROM public.users u WHERE u.auth_id = auth.uid())
    );
$$;

REVOKE ALL ON FUNCTION public.create_giveaway_funded(UUID, TEXT, BIGINT, BIGINT, public.giveaway_type, UUID, BOOLEAN, BOOLEAN, TEXT) FROM PUBLIC;
REVOKE ALL ON FUNCTION public.redeem_giveaway_code(UUID, TEXT) FROM PUBLIC;
REVOKE ALL ON FUNCTION public.stop_giveaway_funded(UUID, UUID) FROM PUBLIC;

GRANT EXECUTE ON FUNCTION public.create_giveaway_funded(UUID, TEXT, BIGINT, BIGINT, public.giveaway_type, UUID, BOOLEAN, BOOLEAN, TEXT) TO service_role;
GRANT EXECUTE ON FUNCTION public.redeem_giveaway_code(UUID, TEXT) TO service_role;
GRANT EXECUTE ON FUNCTION public.stop_giveaway_funded(UUID, UUID) TO service_role;
GRANT EXECUTE ON FUNCTION public.get_event_screen_giveaways(UUID) TO anon, authenticated;

-- Allow anonymous viewers to read active event-screen giveaways on public live events (projector realtime).
CREATE POLICY "Anon can view event screen giveaways"
  ON public.giveaways FOR SELECT TO anon
  USING (
    status = 'active'
    AND show_on_event_screen = true
    AND event_id IS NOT NULL
    AND EXISTS (
      SELECT 1 FROM public.events e
      WHERE e.id = giveaways.event_id
        AND e.status = 'live'
        AND e.is_private = false
    )
  );
