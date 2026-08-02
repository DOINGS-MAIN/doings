-- Guest-created event giveaways: validate participant/host on fund, expose live events for picker.

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

CREATE OR REPLACE FUNCTION public.get_my_live_events_for_giveaway()
RETURNS SETOF public.events
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path = public
AS $$
  SELECT DISTINCT e.*
  FROM public.events e
  JOIN public.users u ON u.auth_id = auth.uid()
  WHERE e.status = 'live'
    AND (
      e.host_id = u.id
      OR EXISTS (
        SELECT 1
        FROM public.event_participants ep
        WHERE ep.event_id = e.id
          AND ep.user_id = u.id
      )
    )
  ORDER BY e.started_at DESC NULLS LAST, e.created_at DESC;
$$;

-- Newest drops first on projector carousel.
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
    )
  ORDER BY g.created_at DESC;
$$;

GRANT EXECUTE ON FUNCTION public.get_my_live_events_for_giveaway() TO authenticated;
