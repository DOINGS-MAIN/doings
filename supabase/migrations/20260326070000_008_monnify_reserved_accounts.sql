-- Migration 008: Monnify Reserved Accounts
-- ================================================

CREATE TABLE public.monnify_reserved_accounts (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id UUID NOT NULL REFERENCES public.users(id) ON DELETE CASCADE,
  wallet_id UUID NOT NULL REFERENCES public.wallets(id),
  account_reference VARCHAR(100) NOT NULL UNIQUE,
  account_name VARCHAR(200) NOT NULL,
  account_number VARCHAR(10) NOT NULL,
  bank_name VARCHAR(100) NOT NULL,
  bank_code VARCHAR(10) NOT NULL,
  reservation_reference VARCHAR(100),
  status VARCHAR(20) NOT NULL DEFAULT 'ACTIVE'
    CHECK (status IN ('ACTIVE', 'INACTIVE')),
  created_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE INDEX idx_monnify_user ON public.monnify_reserved_accounts(user_id);
CREATE INDEX idx_monnify_acct_ref ON public.monnify_reserved_accounts(account_reference);
CREATE INDEX idx_monnify_acct_num ON public.monnify_reserved_accounts(account_number);
