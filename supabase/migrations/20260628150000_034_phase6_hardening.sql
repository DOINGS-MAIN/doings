-- Migration 034: Phase 6 hardening (provider health + admin refund)
-- =================================================================

DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_enum e
    JOIN pg_type t ON e.enumtypid = t.oid
    WHERE t.typname = 'transaction_type' AND e.enumlabel = 'refund'
  ) THEN
    ALTER TYPE public.transaction_type ADD VALUE 'refund';
  END IF;
END $$;

CREATE TABLE public.provider_health (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  provider_id TEXT NOT NULL REFERENCES public.psp_providers(id) ON DELETE CASCADE,
  capability TEXT NOT NULL DEFAULT 'general',
  ok BOOLEAN NOT NULL,
  message TEXT NOT NULL DEFAULT '',
  details JSONB,
  checked_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE INDEX idx_provider_health_provider ON public.provider_health(provider_id, checked_at DESC);

ALTER TABLE public.provider_health ENABLE ROW LEVEL SECURITY;

CREATE POLICY "Admins can view provider health"
  ON public.provider_health FOR SELECT TO authenticated
  USING (public.is_any_admin(auth.uid()));

CREATE POLICY "Admins can view webhook logs"
  ON public.webhook_logs FOR SELECT TO authenticated
  USING (public.is_any_admin(auth.uid()));

-- Admin refund: credit user wallet and mark source transaction refunded.
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
DECLARE
  v_txn RECORD;
  v_refund_txn_id UUID;
  v_idempotency TEXT;
BEGIN
  IF NOT public.is_any_admin(p_admin_auth_id) THEN
    RAISE EXCEPTION 'Admin access required';
  END IF;

  SELECT id, wallet_id, user_id, currency, type, amount, fee, net_amount, status
  INTO v_txn
  FROM public.transactions
  WHERE id = p_transaction_id
  FOR UPDATE;

  IF NOT FOUND THEN
    RAISE EXCEPTION 'Transaction not found';
  END IF;

  IF v_txn.status != 'completed' THEN
    RAISE EXCEPTION 'Only completed transactions can be refunded';
  END IF;

  IF v_txn.net_amount <= 0 THEN
    RAISE EXCEPTION 'Transaction has no refundable amount';
  END IF;

  IF v_txn.type NOT IN ('deposit', 'spray', 'giveaway') THEN
    RAISE EXCEPTION 'Refund not supported for transaction type: %', v_txn.type;
  END IF;

  v_idempotency := 'admin-refund-' || p_transaction_id::text;

  v_refund_txn_id := public.credit_wallet(
    v_txn.wallet_id,
    v_txn.user_id,
    ABS(v_txn.net_amount),
    0,
    'refund',
    COALESCE(p_reason, 'Admin refund'),
    'internal',
    p_transaction_id::text,
    v_idempotency,
    jsonb_build_object('refunded_transaction_id', p_transaction_id, 'admin_id', p_admin_auth_id)
  );

  UPDATE public.transactions
  SET status = 'refunded',
      metadata = COALESCE(metadata, '{}'::jsonb) || jsonb_build_object(
        'refunded_at', now(),
        'refunded_by', p_admin_auth_id,
        'refund_reason', p_reason,
        'refund_transaction_id', v_refund_txn_id
      ),
      updated_at = now()
  WHERE id = p_transaction_id;

  PERFORM public.log_admin_action(
    p_admin_auth_id,
    'refund_transaction',
    'transaction',
    p_transaction_id,
    jsonb_build_object('reason', p_reason, 'refund_transaction_id', v_refund_txn_id)
  );

  RETURN v_refund_txn_id;
END;
$$;

GRANT EXECUTE ON FUNCTION public.admin_refund_transaction(UUID, UUID, TEXT) TO authenticated;
