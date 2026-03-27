-- Migration 007: Transfers & Bank Accounts
-- ================================================

CREATE TABLE public.transfers (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  sender_wallet_id UUID NOT NULL REFERENCES public.wallets(id),
  receiver_wallet_id UUID NOT NULL REFERENCES public.wallets(id),
  sender_user_id UUID NOT NULL REFERENCES public.users(id),
  receiver_user_id UUID NOT NULL REFERENCES public.users(id),
  currency currency NOT NULL,
  amount BIGINT NOT NULL CHECK (amount > 0),
  fee BIGINT NOT NULL DEFAULT 0,
  status transaction_status NOT NULL DEFAULT 'completed',
  sender_transaction_id UUID REFERENCES public.transactions(id),
  receiver_transaction_id UUID REFERENCES public.transactions(id),
  description TEXT,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE INDEX idx_transfers_sender ON public.transfers(sender_user_id);
CREATE INDEX idx_transfers_receiver ON public.transfers(receiver_user_id);
CREATE INDEX idx_transfers_created ON public.transfers(created_at DESC);

CREATE TABLE public.bank_accounts (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id UUID NOT NULL REFERENCES public.users(id) ON DELETE CASCADE,
  bank_code VARCHAR(10) NOT NULL,
  bank_name VARCHAR(100) NOT NULL,
  account_number VARCHAR(10) NOT NULL,
  account_name VARCHAR(200) NOT NULL,
  is_default BOOLEAN DEFAULT false,
  is_verified BOOLEAN DEFAULT false,
  verified_at TIMESTAMPTZ,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE INDEX idx_bank_user ON public.bank_accounts(user_id);
CREATE UNIQUE INDEX idx_bank_default
  ON public.bank_accounts(user_id) WHERE is_default = true;
CREATE UNIQUE INDEX idx_bank_unique_account
  ON public.bank_accounts(user_id, bank_code, account_number);

CREATE OR REPLACE FUNCTION public.ensure_single_default_bank()
RETURNS TRIGGER AS $$
BEGIN
  IF NEW.is_default = true THEN
    UPDATE public.bank_accounts
    SET is_default = false
    WHERE user_id = NEW.user_id
      AND id != NEW.id
      AND is_default = true;
  END IF;
  RETURN NEW;
END;
$$ LANGUAGE plpgsql;

CREATE TRIGGER tr_bank_single_default
  BEFORE INSERT OR UPDATE OF is_default ON public.bank_accounts
  FOR EACH ROW
  WHEN (NEW.is_default = true)
  EXECUTE FUNCTION public.ensure_single_default_bank();
