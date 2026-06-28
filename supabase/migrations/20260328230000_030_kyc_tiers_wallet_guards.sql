-- Migration 030: KYC tiers 0–2, email→L1 sync, L2 attempt log, wallet credit/debit guards

-- ── Normalize legacy level 3 → 2 ──
UPDATE public.users SET kyc_level = 2 WHERE kyc_level = 3;

ALTER TABLE public.users DROP CONSTRAINT IF EXISTS users_kyc_level_check;
ALTER TABLE public.users ADD CONSTRAINT users_kyc_level_check CHECK (kyc_level BETWEEN 0 AND 2);

ALTER TABLE public.kyc_verifications DROP CONSTRAINT IF EXISTS kyc_verifications_level_check;
UPDATE public.kyc_verifications SET level = 2 WHERE level = 3;
ALTER TABLE public.kyc_verifications ADD CONSTRAINT kyc_verifications_level_check CHECK (level BETWEEN 1 AND 2);

-- Inserts with status = verified must bump users.kyc_level (UPDATE-only trigger missed these before)
DROP TRIGGER IF EXISTS tr_kyc_update_user_level_ins ON public.kyc_verifications;
CREATE TRIGGER tr_kyc_update_user_level_ins
  AFTER INSERT ON public.kyc_verifications
  FOR EACH ROW
  WHEN (NEW.status = 'verified')
  EXECUTE FUNCTION public.update_user_kyc_level();

-- Backfill L1 from confirmed emails (idempotent with trigger below)
UPDATE public.users u
SET kyc_level = GREATEST(u.kyc_level, 1), updated_at = now()
FROM auth.users a
WHERE u.auth_id = a.id AND a.email_confirmed_at IS NOT NULL;

-- ── Rate limit log for L2 verification attempts (edge inserts via service role) ──
CREATE TABLE public.kyc_l2_attempts (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id UUID NOT NULL REFERENCES public.users(id) ON DELETE CASCADE,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE INDEX idx_kyc_l2_attempts_user_created ON public.kyc_l2_attempts(user_id, created_at DESC);
ALTER TABLE public.kyc_l2_attempts ENABLE ROW LEVEL SECURITY;

-- ── When email is confirmed, bump user to at least L1 ──
CREATE OR REPLACE FUNCTION public.sync_kyc_on_email_confirmed()
RETURNS TRIGGER
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
BEGIN
  IF NEW.email_confirmed_at IS NOT NULL AND (
    TG_OP = 'INSERT'
    OR OLD.email_confirmed_at IS NULL
    OR OLD.email_confirmed_at IS DISTINCT FROM NEW.email_confirmed_at
  ) THEN
    UPDATE public.users
    SET kyc_level = GREATEST(kyc_level, 1), updated_at = now()
    WHERE auth_id = NEW.id;
  END IF;
  RETURN NEW;
END;
$$;

DROP TRIGGER IF EXISTS tr_auth_email_confirmed_kyc ON auth.users;
CREATE TRIGGER tr_auth_email_confirmed_kyc
  AFTER INSERT OR UPDATE OF email_confirmed_at ON auth.users
  FOR EACH ROW
  EXECUTE FUNCTION public.sync_kyc_on_email_confirmed();

-- ── credit_wallet: no inbound balance for unverified email (L0) ──
CREATE OR REPLACE FUNCTION public.credit_wallet(
  p_wallet_id UUID,
  p_user_id UUID,
  p_amount BIGINT,
  p_fee BIGINT DEFAULT 0,
  p_type transaction_type DEFAULT 'deposit',
  p_description TEXT DEFAULT '',
  p_provider VARCHAR(20) DEFAULT 'internal',
  p_provider_ref VARCHAR(255) DEFAULT NULL,
  p_idempotency_key VARCHAR(255) DEFAULT NULL,
  p_metadata JSONB DEFAULT NULL
)
RETURNS UUID AS $$
DECLARE
  v_txn_id UUID;
  v_balance_before BIGINT;
  v_net_amount BIGINT;
  v_wallet_currency currency;
  v_kyc SMALLINT;
BEGIN
  IF p_idempotency_key IS NULL THEN
    p_idempotency_key := 'auto-' || gen_random_uuid()::text;
  END IF;

  SELECT id INTO v_txn_id
  FROM public.transactions
  WHERE idempotency_key = p_idempotency_key;

  IF v_txn_id IS NOT NULL THEN
    RETURN v_txn_id;
  END IF;

  v_net_amount := p_amount - p_fee;

  SELECT kyc_level INTO v_kyc FROM public.users WHERE id = p_user_id;
  IF NOT FOUND THEN
    RAISE EXCEPTION 'User not found: %', p_user_id;
  END IF;

  IF v_net_amount > 0 AND v_kyc < 1 THEN
    RAISE EXCEPTION 'Verify your email to receive funds';
  END IF;

  SELECT balance, currency INTO v_balance_before, v_wallet_currency
  FROM public.wallets
  WHERE id = p_wallet_id
  FOR UPDATE;

  IF NOT FOUND THEN
    RAISE EXCEPTION 'Wallet not found: %', p_wallet_id;
  END IF;

  UPDATE public.wallets
  SET balance = balance + v_net_amount,
      updated_at = now()
  WHERE id = p_wallet_id;

  INSERT INTO public.transactions (
    wallet_id, user_id, currency, type, amount, fee,
    net_amount, status, provider, provider_ref,
    idempotency_key, description, metadata, completed_at
  ) VALUES (
    p_wallet_id, p_user_id, v_wallet_currency, p_type, p_amount, p_fee,
    v_net_amount, 'completed', p_provider, p_provider_ref,
    p_idempotency_key, p_description, p_metadata, now()
  )
  RETURNING id INTO v_txn_id;

  INSERT INTO public.ledger_entries (
    transaction_id, wallet_id, entry_type, amount, balance_before, balance_after
  ) VALUES (
    v_txn_id, p_wallet_id, 'credit', v_net_amount, v_balance_before, v_balance_before + v_net_amount
  );

  RETURN v_txn_id;
END;
$$ LANGUAGE plpgsql SECURITY DEFINER;

-- ── debit_wallet: spending/sending requires L2 ──
CREATE OR REPLACE FUNCTION public.debit_wallet(
  p_wallet_id UUID,
  p_user_id UUID,
  p_amount BIGINT,
  p_fee BIGINT DEFAULT 0,
  p_type transaction_type DEFAULT 'send',
  p_description TEXT DEFAULT '',
  p_provider VARCHAR(20) DEFAULT 'internal',
  p_idempotency_key VARCHAR(255) DEFAULT NULL,
  p_metadata JSONB DEFAULT NULL
)
RETURNS UUID AS $$
DECLARE
  v_txn_id UUID;
  v_balance_before BIGINT;
  v_locked_balance BIGINT;
  v_available BIGINT;
  v_total_debit BIGINT;
  v_wallet_currency currency;
  v_kyc SMALLINT;
BEGIN
  IF p_idempotency_key IS NULL THEN
    p_idempotency_key := 'auto-' || gen_random_uuid()::text;
  END IF;

  SELECT id INTO v_txn_id
  FROM public.transactions
  WHERE idempotency_key = p_idempotency_key;

  IF v_txn_id IS NOT NULL THEN
    RETURN v_txn_id;
  END IF;

  v_total_debit := p_amount + p_fee;

  SELECT kyc_level INTO v_kyc FROM public.users WHERE id = p_user_id;
  IF NOT FOUND THEN
    RAISE EXCEPTION 'User not found: %', p_user_id;
  END IF;

  IF v_total_debit > 0 AND v_kyc < 2 THEN
    RAISE EXCEPTION 'Complete identity verification (BVN + NIN) to send or spend funds';
  END IF;

  SELECT balance, locked_balance, currency
  INTO v_balance_before, v_locked_balance, v_wallet_currency
  FROM public.wallets
  WHERE id = p_wallet_id
  FOR UPDATE;

  IF NOT FOUND THEN
    RAISE EXCEPTION 'Wallet not found: %', p_wallet_id;
  END IF;

  v_available := v_balance_before - v_locked_balance;
  IF v_available < v_total_debit THEN
    RAISE EXCEPTION 'Insufficient balance. Available: %, Required: %', v_available, v_total_debit;
  END IF;

  UPDATE public.wallets
  SET balance = balance - v_total_debit,
      updated_at = now()
  WHERE id = p_wallet_id;

  INSERT INTO public.transactions (
    wallet_id, user_id, currency, type, amount, fee,
    net_amount, status, provider, idempotency_key,
    description, metadata, completed_at
  ) VALUES (
    p_wallet_id, p_user_id, v_wallet_currency, p_type, -p_amount, p_fee,
    -v_total_debit, 'completed', p_provider, p_idempotency_key,
    p_description, p_metadata, now()
  )
  RETURNING id INTO v_txn_id;

  INSERT INTO public.ledger_entries (
    transaction_id, wallet_id, entry_type, amount, balance_before, balance_after
  ) VALUES (
    v_txn_id, p_wallet_id, 'debit', v_total_debit, v_balance_before, v_balance_before - v_total_debit
  );

  RETURN v_txn_id;
END;
$$ LANGUAGE plpgsql SECURITY DEFINER;
