-- Migration 022: Anomaly detection triggers
-- ================================================
-- Auto-flag transactions that exceed thresholds or show suspicious patterns.

CREATE TABLE IF NOT EXISTS public.transaction_flags (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  transaction_id UUID NOT NULL REFERENCES public.transactions(id),
  user_id UUID NOT NULL REFERENCES public.users(id),
  flag_type VARCHAR(50) NOT NULL,
  reason TEXT NOT NULL,
  severity VARCHAR(20) NOT NULL DEFAULT 'medium'
    CHECK (severity IN ('low', 'medium', 'high', 'critical')),
  resolved BOOLEAN DEFAULT false,
  resolved_by UUID REFERENCES auth.users(id),
  resolved_at TIMESTAMPTZ,
  resolution_note TEXT,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE INDEX idx_flags_txn ON public.transaction_flags(transaction_id);
CREATE INDEX idx_flags_user ON public.transaction_flags(user_id);
CREATE INDEX idx_flags_unresolved ON public.transaction_flags(resolved, created_at DESC) WHERE resolved = false;
CREATE INDEX idx_flags_severity ON public.transaction_flags(severity) WHERE resolved = false;

-- Flag large single transactions
CREATE OR REPLACE FUNCTION public.check_large_transaction()
RETURNS TRIGGER AS $$
DECLARE
  v_threshold BIGINT;
  v_severity TEXT;
BEGIN
  IF NEW.type NOT IN ('withdrawal', 'deposit', 'transfer', 'send') THEN RETURN NEW; END IF;

  IF NEW.currency = 'NGN' THEN
    v_threshold := 50000000; -- ₦500,000
  ELSE
    v_threshold := 500000000; -- 500 USDT
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
$$ LANGUAGE plpgsql SECURITY DEFINER;

CREATE TRIGGER tr_check_large_transaction
  AFTER INSERT ON public.transactions
  FOR EACH ROW
  EXECUTE FUNCTION public.check_large_transaction();

-- Flag high-frequency transactions (>10 in 5 minutes for the same user)
CREATE OR REPLACE FUNCTION public.check_high_frequency()
RETURNS TRIGGER AS $$
DECLARE
  v_count INT;
BEGIN
  IF NEW.type NOT IN ('withdrawal', 'transfer', 'send', 'spray') THEN RETURN NEW; END IF;

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
$$ LANGUAGE plpgsql SECURITY DEFINER;

CREATE TRIGGER tr_check_high_frequency
  AFTER INSERT ON public.transactions
  FOR EACH ROW
  EXECUTE FUNCTION public.check_high_frequency();

-- Flag multiple failed withdrawals (>3 in 1 hour)
CREATE OR REPLACE FUNCTION public.check_failed_withdrawals()
RETURNS TRIGGER AS $$
DECLARE
  v_count INT;
BEGIN
  IF NEW.type != 'withdrawal' OR NEW.status != 'failed' THEN RETURN NEW; END IF;
  IF OLD IS NOT NULL AND OLD.status = NEW.status THEN RETURN NEW; END IF;

  SELECT COUNT(*) INTO v_count
  FROM public.transactions
  WHERE user_id = NEW.user_id
    AND type = 'withdrawal'
    AND status = 'failed'
    AND created_at >= now() - INTERVAL '1 hour';

  IF v_count >= 3 THEN
    INSERT INTO public.transaction_flags (transaction_id, user_id, flag_type, reason, severity)
    VALUES (
      NEW.id, NEW.user_id, 'repeated_failures',
      v_count || ' failed withdrawals in the past hour',
      'high'
    );
  END IF;

  RETURN NEW;
END;
$$ LANGUAGE plpgsql SECURITY DEFINER;

CREATE TRIGGER tr_check_failed_withdrawals
  AFTER UPDATE OF status ON public.transactions
  FOR EACH ROW
  WHEN (NEW.status = 'failed' AND NEW.type = 'withdrawal')
  EXECUTE FUNCTION public.check_failed_withdrawals();
