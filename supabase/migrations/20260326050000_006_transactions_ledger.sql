-- Migration 006: Transactions & Ledger
-- ================================================

CREATE TABLE public.transactions (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  wallet_id UUID NOT NULL REFERENCES public.wallets(id),
  user_id UUID NOT NULL REFERENCES public.users(id),
  currency currency NOT NULL,
  type transaction_type NOT NULL,
  amount BIGINT NOT NULL,
  fee BIGINT NOT NULL DEFAULT 0,
  net_amount BIGINT NOT NULL,
  status transaction_status NOT NULL DEFAULT 'pending',
  provider VARCHAR(20)
    CHECK (provider IN ('monnify', 'blockradar', 'quidax', 'internal')),
  provider_ref VARCHAR(255),
  idempotency_key VARCHAR(255) NOT NULL UNIQUE,
  description TEXT NOT NULL,
  metadata JSONB,
  flagged BOOLEAN DEFAULT false,
  flag_reason TEXT,
  flagged_by UUID REFERENCES auth.users(id),
  flagged_at TIMESTAMPTZ,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  completed_at TIMESTAMPTZ,
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE INDEX idx_txn_wallet ON public.transactions(wallet_id);
CREATE INDEX idx_txn_user ON public.transactions(user_id);
CREATE INDEX idx_txn_status ON public.transactions(status);
CREATE INDEX idx_txn_type ON public.transactions(type);
CREATE INDEX idx_txn_created ON public.transactions(created_at DESC);
CREATE INDEX idx_txn_idempotency ON public.transactions(idempotency_key);
CREATE INDEX idx_txn_provider_ref ON public.transactions(provider_ref)
  WHERE provider_ref IS NOT NULL;
CREATE INDEX idx_txn_flagged ON public.transactions(flagged)
  WHERE flagged = true;

CREATE TRIGGER tr_transactions_updated_at
  BEFORE UPDATE ON public.transactions
  FOR EACH ROW EXECUTE FUNCTION public.update_updated_at();

CREATE TABLE public.ledger_entries (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  transaction_id UUID NOT NULL REFERENCES public.transactions(id),
  wallet_id UUID NOT NULL REFERENCES public.wallets(id),
  entry_type VARCHAR(10) NOT NULL
    CHECK (entry_type IN ('debit', 'credit')),
  amount BIGINT NOT NULL CHECK (amount > 0),
  balance_before BIGINT NOT NULL,
  balance_after BIGINT NOT NULL,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE INDEX idx_ledger_txn ON public.ledger_entries(transaction_id);
CREATE INDEX idx_ledger_wallet ON public.ledger_entries(wallet_id);
CREATE INDEX idx_ledger_created ON public.ledger_entries(created_at DESC);
