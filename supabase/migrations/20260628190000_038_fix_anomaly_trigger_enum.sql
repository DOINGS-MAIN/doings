-- Migration 038: Fix anomaly triggers referencing invalid transaction_type enum value "transfer"
-- =========================================================================================
-- transaction_type enum has 'send' / 'receive', not 'transfer'. Comparing against 'transfer'
-- raised 22P02 and rolled back every deposit credit.

CREATE OR REPLACE FUNCTION public.check_large_transaction()
RETURNS TRIGGER AS $$
DECLARE
  v_threshold BIGINT;
  v_severity TEXT;
BEGIN
  IF NEW.type NOT IN ('withdrawal', 'deposit', 'send', 'receive') THEN RETURN NEW; END IF;

  IF NEW.currency = 'NGN' THEN
    v_threshold := 50000000;
  ELSE
    v_threshold := 500000000;
  END IF;

  IF ABS(NEW.amount) >= v_threshold THEN
    IF ABS(NEW.amount) >= v_threshold * 4 THEN
      v_severity := 'critical';
    ELSIF ABS(NEW.amount) >= v_threshold * 2 THEN
      v_severity := 'high';
    ELSE
      v_severity := 'medium';
    END IF;

    INSERT INTO public.transaction_flags (transaction_id, user_id, flag_type, reason, severity)
    VALUES (
      NEW.id, NEW.user_id, 'large_amount',
      'Transaction of ' || ABS(NEW.amount) || ' ' || NEW.currency || ' exceeds threshold of ' || v_threshold,
      v_severity
    );
  END IF;

  RETURN NEW;
END;
$$ LANGUAGE plpgsql SECURITY DEFINER SET search_path = public;

CREATE OR REPLACE FUNCTION public.check_high_frequency()
RETURNS TRIGGER AS $$
DECLARE
  v_count INT;
BEGIN
  IF NEW.type NOT IN ('withdrawal', 'send', 'receive', 'spray') THEN RETURN NEW; END IF;

  SELECT COUNT(*) INTO v_count
  FROM public.transactions
  WHERE user_id = NEW.user_id
    AND type = NEW.type
    AND created_at >= now() - INTERVAL '5 minutes'
    AND id != NEW.id;

  IF v_count >= 10 THEN
    INSERT INTO public.transaction_flags (transaction_id, user_id, flag_type, reason, severity)
    VALUES (
      NEW.id, NEW.user_id, 'high_frequency',
      v_count + 1 || ' ' || NEW.type || ' transactions in 5 minutes',
      CASE WHEN v_count >= 20 THEN 'critical' WHEN v_count >= 15 THEN 'high' ELSE 'medium' END
    );
  END IF;

  RETURN NEW;
END;
$$ LANGUAGE plpgsql SECURITY DEFINER SET search_path = public;
