-- Migration 021: Notification triggers
-- ================================================
-- Auto-create notifications on key events.

-- Helper to insert a notification
CREATE OR REPLACE FUNCTION public.create_notification(
  p_user_id UUID,
  p_type VARCHAR(50),
  p_title VARCHAR(200),
  p_body TEXT DEFAULT NULL,
  p_data JSONB DEFAULT NULL
)
RETURNS UUID AS $$
DECLARE
  v_id UUID;
BEGIN
  INSERT INTO public.notifications (user_id, type, title, body, data)
  VALUES (p_user_id, p_type, p_title, p_body, p_data)
  RETURNING id INTO v_id;
  RETURN v_id;
END;
$$ LANGUAGE plpgsql SECURITY DEFINER;

-- ── Deposit / Withdrawal completed ──
CREATE OR REPLACE FUNCTION public.notify_transaction_status()
RETURNS TRIGGER AS $$
DECLARE
  v_title TEXT;
  v_body TEXT;
  v_type TEXT;
  v_currency TEXT;
  v_display_amount TEXT;
BEGIN
  IF OLD.status = NEW.status THEN RETURN NEW; END IF;
  IF NEW.status NOT IN ('completed', 'failed') THEN RETURN NEW; END IF;
  IF NEW.type NOT IN ('deposit', 'withdrawal') THEN RETURN NEW; END IF;

  SELECT currency INTO v_currency FROM public.wallets WHERE id = NEW.wallet_id;

  IF v_currency = 'NGN' THEN
    v_display_amount := '₦' || TRIM(to_char(ABS(NEW.amount) / 100.0, '999,999,999.00'));
  ELSE
    v_display_amount := TRIM(to_char(ABS(NEW.amount) / 1000000.0, '999,999.00')) || ' USDT';
  END IF;

  IF NEW.type = 'deposit' AND NEW.status = 'completed' THEN
    v_type := 'deposit_completed';
    v_title := 'Deposit received';
    v_body := v_display_amount || ' has been credited to your wallet.';
  ELSIF NEW.type = 'withdrawal' AND NEW.status = 'completed' THEN
    v_type := 'withdrawal_completed';
    v_title := 'Withdrawal successful';
    v_body := v_display_amount || ' has been sent to your bank account.';
  ELSIF NEW.type = 'withdrawal' AND NEW.status = 'failed' THEN
    v_type := 'withdrawal_failed';
    v_title := 'Withdrawal failed';
    v_body := v_display_amount || ' withdrawal failed. Funds have been released back to your wallet.';
  ELSE
    RETURN NEW;
  END IF;

  PERFORM public.create_notification(
    NEW.user_id, v_type, v_title, v_body,
    jsonb_build_object('transaction_id', NEW.id, 'amount', ABS(NEW.amount), 'currency', v_currency)
  );

  RETURN NEW;
END;
$$ LANGUAGE plpgsql SECURITY DEFINER;

CREATE TRIGGER tr_notify_transaction_status
  AFTER UPDATE OF status ON public.transactions
  FOR EACH ROW
  WHEN (NEW.status IN ('completed', 'failed'))
  EXECUTE FUNCTION public.notify_transaction_status();

-- Also fire on INSERT for deposits that land as completed immediately
CREATE OR REPLACE FUNCTION public.notify_deposit_insert()
RETURNS TRIGGER AS $$
DECLARE
  v_currency TEXT;
  v_display_amount TEXT;
BEGIN
  IF NEW.type != 'deposit' OR NEW.status != 'completed' THEN RETURN NEW; END IF;

  SELECT currency INTO v_currency FROM public.wallets WHERE id = NEW.wallet_id;

  IF v_currency = 'NGN' THEN
    v_display_amount := '₦' || TRIM(to_char(ABS(NEW.amount) / 100.0, '999,999,999.00'));
  ELSE
    v_display_amount := TRIM(to_char(ABS(NEW.amount) / 1000000.0, '999,999.00')) || ' USDT';
  END IF;

  PERFORM public.create_notification(
    NEW.user_id, 'deposit_completed', 'Deposit received',
    v_display_amount || ' has been credited to your wallet.',
    jsonb_build_object('transaction_id', NEW.id, 'amount', ABS(NEW.amount), 'currency', v_currency)
  );

  RETURN NEW;
END;
$$ LANGUAGE plpgsql SECURITY DEFINER;

CREATE TRIGGER tr_notify_deposit_insert
  AFTER INSERT ON public.transactions
  FOR EACH ROW
  WHEN (NEW.type = 'deposit' AND NEW.status = 'completed')
  EXECUTE FUNCTION public.notify_deposit_insert();

-- ── Spray received ──
CREATE OR REPLACE FUNCTION public.notify_spray_received()
RETURNS TRIGGER AS $$
DECLARE
  v_sprayer_name TEXT;
  v_display_amount TEXT;
BEGIN
  SELECT COALESCE(full_name, username, phone) INTO v_sprayer_name
  FROM public.users WHERE id = NEW.sprayer_id;

  v_display_amount := '₦' || TRIM(to_char(NEW.amount / 100.0, '999,999,999.00'));

  PERFORM public.create_notification(
    NEW.receiver_id, 'spray_received', 'You got sprayed!',
    v_sprayer_name || ' sprayed ' || v_display_amount || ' on you.',
    jsonb_build_object('spray_id', NEW.id, 'event_id', NEW.event_id, 'sprayer_id', NEW.sprayer_id, 'amount', NEW.amount)
  );

  RETURN NEW;
END;
$$ LANGUAGE plpgsql SECURITY DEFINER;

CREATE TRIGGER tr_notify_spray_received
  AFTER INSERT ON public.spray_records
  FOR EACH ROW
  EXECUTE FUNCTION public.notify_spray_received();

-- ── KYC status change ──
CREATE OR REPLACE FUNCTION public.notify_kyc_status()
RETURNS TRIGGER AS $$
DECLARE
  v_title TEXT;
  v_body TEXT;
  v_type TEXT;
BEGIN
  IF OLD.status = NEW.status THEN RETURN NEW; END IF;

  IF NEW.status = 'verified' THEN
    v_type := 'kyc_approved';
    v_title := 'KYC Verified';
    v_body := 'Your level ' || NEW.level || ' verification has been approved. You now have access to more features.';
  ELSIF NEW.status = 'rejected' THEN
    v_type := 'kyc_rejected';
    v_title := 'KYC Rejected';
    v_body := 'Your level ' || NEW.level || ' verification was not approved.';
    IF NEW.rejection_reason IS NOT NULL THEN
      v_body := v_body || ' Reason: ' || NEW.rejection_reason;
    END IF;
  ELSE
    RETURN NEW;
  END IF;

  PERFORM public.create_notification(
    NEW.user_id, v_type, v_title, v_body,
    jsonb_build_object('kyc_id', NEW.id, 'level', NEW.level, 'status', NEW.status)
  );

  RETURN NEW;
END;
$$ LANGUAGE plpgsql SECURITY DEFINER;

CREATE TRIGGER tr_notify_kyc_status
  AFTER UPDATE OF status ON public.kyc_verifications
  FOR EACH ROW
  WHEN (NEW.status IN ('verified', 'rejected'))
  EXECUTE FUNCTION public.notify_kyc_status();

-- ── Giveaway redeemed (notify creator) ──
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

  PERFORM public.create_notification(
    v_creator_id, 'giveaway_redeemed', 'Giveaway claimed',
    v_redeemer_name || ' claimed ' || v_display_amount || ' from "' || v_title || '".',
    jsonb_build_object('giveaway_id', NEW.giveaway_id, 'redemption_id', NEW.id, 'user_id', NEW.user_id, 'amount', NEW.amount)
  );

  RETURN NEW;
END;
$$ LANGUAGE plpgsql SECURITY DEFINER;

CREATE TRIGGER tr_notify_giveaway_redeemed
  AFTER INSERT ON public.giveaway_redemptions
  FOR EACH ROW
  EXECUTE FUNCTION public.notify_giveaway_redeemed();
