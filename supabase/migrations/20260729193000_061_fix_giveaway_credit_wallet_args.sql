-- Fix credit_wallet argument order in giveaway RPCs.
-- credit_wallet(..., provider, provider_ref, idempotency_key, metadata)
-- Migration 060 passed idempotency_key where provider_ref belongs.

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
      0::bigint,
      'giveaway_refund'::transaction_type,
      'Giveaway refund: ' || v_giveaway.id::text,
      'internal',
      NULL,
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

-- Do not block redemption if creator notification insert fails.
CREATE OR REPLACE FUNCTION public.notify_giveaway_redeemed()
RETURNS TRIGGER AS $$
DECLARE
  v_creator_id UUID;
  v_title TEXT;
  v_redeemer_name TEXT;
  v_display_amount TEXT;
BEGIN
  SELECT creator_id, title INTO v_creator_id, v_title
  FROM public.giveaways WHERE id = NEW.giveaway_id;

  SELECT COALESCE(full_name, username, phone) INTO v_redeemer_name
  FROM public.users WHERE id = NEW.user_id;

  v_display_amount := '₦' || TRIM(to_char(NEW.amount / 100.0, '999,999,999.00'));

  BEGIN
    PERFORM public.create_notification(
      v_creator_id, 'giveaway_redeemed', 'Giveaway claimed',
      v_redeemer_name || ' claimed ' || v_display_amount || ' from "' || v_title || '".',
      jsonb_build_object('giveaway_id', NEW.giveaway_id, 'redemption_id', NEW.id, 'user_id', NEW.user_id, 'amount', NEW.amount)
    );
  EXCEPTION WHEN OTHERS THEN
    RAISE WARNING 'notify_giveaway_redeemed failed for redemption %: %', NEW.id, SQLERRM;
  END;

  RETURN NEW;
END;
$$ LANGUAGE plpgsql SECURITY DEFINER SET search_path = public;

REVOKE ALL ON FUNCTION public.redeem_giveaway_code(UUID, TEXT) FROM PUBLIC;
REVOKE ALL ON FUNCTION public.stop_giveaway_funded(UUID, UUID) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.redeem_giveaway_code(UUID, TEXT) TO service_role;
GRANT EXECUTE ON FUNCTION public.stop_giveaway_funded(UUID, UUID) TO service_role;
