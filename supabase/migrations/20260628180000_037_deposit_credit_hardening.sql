-- Migration 037: Prevent side-effect triggers from blocking inbound deposits

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
$$ LANGUAGE plpgsql SECURITY DEFINER SET search_path = public;

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

  BEGIN
    PERFORM public.create_notification(
      NEW.user_id, 'deposit_completed', 'Deposit received',
      v_display_amount || ' has been credited to your wallet.',
      jsonb_build_object('transaction_id', NEW.id, 'amount', ABS(NEW.amount), 'currency', v_currency)
    );
  EXCEPTION WHEN OTHERS THEN
    RAISE WARNING 'notify_deposit_insert failed for txn %: %', NEW.id, SQLERRM;
  END;

  RETURN NEW;
END;
$$ LANGUAGE plpgsql SECURITY DEFINER SET search_path = public;

-- Service role policies so SECURITY DEFINER wallet credits can write ledger rows under RLS.
DROP POLICY IF EXISTS "Service role manages ledger" ON public.ledger_entries;
CREATE POLICY "Service role manages ledger"
  ON public.ledger_entries FOR ALL TO service_role
  USING (true) WITH CHECK (true);

DROP POLICY IF EXISTS "Service role manages transactions" ON public.transactions;
CREATE POLICY "Service role manages transactions"
  ON public.transactions FOR ALL TO service_role
  USING (true) WITH CHECK (true);

DROP POLICY IF EXISTS "Service role inserts notifications" ON public.notifications;
CREATE POLICY "Service role inserts notifications"
  ON public.notifications FOR INSERT TO service_role
  WITH CHECK (true);

GRANT EXECUTE ON FUNCTION public.credit_wallet(
  UUID, UUID, BIGINT, BIGINT, transaction_type, TEXT, VARCHAR, VARCHAR, VARCHAR, JSONB
) TO service_role;
