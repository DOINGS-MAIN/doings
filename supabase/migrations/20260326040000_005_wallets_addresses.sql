-- Migration 005: Wallets & Addresses
-- ================================================

CREATE TABLE public.wallets (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id UUID NOT NULL REFERENCES public.users(id) ON DELETE CASCADE,
  currency currency NOT NULL,
  balance BIGINT NOT NULL DEFAULT 0,
  locked_balance BIGINT NOT NULL DEFAULT 0,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  UNIQUE (user_id, currency),
  CONSTRAINT ck_positive_balance CHECK (balance >= 0),
  CONSTRAINT ck_positive_locked CHECK (locked_balance >= 0),
  CONSTRAINT ck_locked_within_balance CHECK (locked_balance <= balance)
);

CREATE INDEX idx_wallets_user ON public.wallets(user_id);
CREATE INDEX idx_wallets_currency ON public.wallets(currency);

CREATE OR REPLACE FUNCTION public.create_user_wallets()
RETURNS TRIGGER AS $$
BEGIN
  INSERT INTO public.wallets (user_id, currency) VALUES
    (NEW.id, 'NGN'),
    (NEW.id, 'USDT');
  RETURN NEW;
END;
$$ LANGUAGE plpgsql SECURITY DEFINER;

CREATE TRIGGER tr_create_wallets_on_user
  AFTER INSERT ON public.users
  FOR EACH ROW EXECUTE FUNCTION public.create_user_wallets();

CREATE TABLE public.wallet_addresses (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  wallet_id UUID NOT NULL REFERENCES public.wallets(id) ON DELETE CASCADE,
  provider VARCHAR(20) NOT NULL
    CHECK (provider IN ('monnify', 'blockradar', 'quidax')),
  address VARCHAR(255) NOT NULL,
  label VARCHAR(100),
  network VARCHAR(20),
  metadata JSONB,
  status VARCHAR(20) NOT NULL DEFAULT 'active'
    CHECK (status IN ('active', 'inactive')),
  created_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE INDEX idx_wallet_addr_wallet ON public.wallet_addresses(wallet_id);
CREATE INDEX idx_wallet_addr_address ON public.wallet_addresses(address);
CREATE INDEX idx_wallet_addr_provider ON public.wallet_addresses(provider);

CREATE TRIGGER tr_wallets_updated_at
  BEFORE UPDATE ON public.wallets
  FOR EACH ROW EXECUTE FUNCTION public.update_updated_at();
