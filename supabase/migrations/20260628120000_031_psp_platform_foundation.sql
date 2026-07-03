-- Migration 031: PSP platform foundation (extensible provider registry)
-- =================================================================

-- ── PSP provider catalog ──
CREATE TABLE public.psp_providers (
  id TEXT PRIMARY KEY,
  display_name TEXT NOT NULL,
  capabilities TEXT[] NOT NULL DEFAULT '{}',
  status TEXT NOT NULL DEFAULT 'active'
    CHECK (status IN ('active', 'disabled', 'sandbox_only')),
  config_schema JSONB NOT NULL DEFAULT '{}'::jsonb,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE TRIGGER tr_psp_providers_updated_at
  BEFORE UPDATE ON public.psp_providers
  FOR EACH ROW EXECUTE FUNCTION public.update_updated_at();

COMMENT ON TABLE public.psp_providers IS
  'Catalog of payment service providers. Add rows + adapter code to onboard new PSPs.';

INSERT INTO public.psp_providers (id, display_name, capabilities, status, config_schema) VALUES
  (
    'monnify',
    'Monnify',
    ARRAY['wallet_funding', 'disbursement', 'bank_verify'],
    'active',
    '{"secrets":["MONNIFY_API_KEY","MONNIFY_SECRET_KEY","MONNIFY_CONTRACT_CODE","MONNIFY_SOURCE_ACCOUNT","MONNIFY_BASE_URL"]}'::jsonb
  ),
  (
    'nomba',
    'Nombank (Nomba)',
    ARRAY['wallet_funding', 'disbursement', 'bank_verify'],
    'sandbox_only',
    '{"secrets":["NOMBA_CLIENT_ID","NOMBA_CLIENT_SECRET","NOMBA_ACCOUNT_ID","NOMBA_SANDBOX"]}'::jsonb
  )
ON CONFLICT (id) DO NOTHING;

-- ── Platform-wide PSP routing (singleton) ──
CREATE TABLE public.platform_settings (
  id SMALLINT PRIMARY KEY DEFAULT 1 CHECK (id = 1),
  wallet_funding_provider_id TEXT NOT NULL DEFAULT 'monnify'
    REFERENCES public.psp_providers(id),
  disbursement_provider_id TEXT NOT NULL DEFAULT 'monnify'
    REFERENCES public.psp_providers(id),
  psp_env TEXT NOT NULL DEFAULT 'sandbox'
    CHECK (psp_env IN ('sandbox', 'production')),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_by UUID REFERENCES auth.users(id) ON DELETE SET NULL
);

ALTER TABLE public.platform_settings ENABLE ROW LEVEL SECURITY;

CREATE POLICY "platform_settings no direct client access"
  ON public.platform_settings FOR ALL TO authenticated
  USING (false) WITH CHECK (false);

INSERT INTO public.platform_settings (id)
VALUES (1)
ON CONFLICT (id) DO NOTHING;

COMMENT ON TABLE public.platform_settings IS
  'Singleton (id=1). Independent wallet funding vs disbursement PSP selection.';

-- ── Generalize reserved accounts (was monnify_reserved_accounts) ──
ALTER TABLE public.monnify_reserved_accounts RENAME TO reserved_accounts;

ALTER TABLE public.reserved_accounts
  ADD COLUMN IF NOT EXISTS provider_id TEXT NOT NULL DEFAULT 'monnify'
    REFERENCES public.psp_providers(id);

ALTER TABLE public.reserved_accounts
  DROP CONSTRAINT IF EXISTS monnify_reserved_accounts_user_id_key;

CREATE UNIQUE INDEX IF NOT EXISTS idx_reserved_accounts_user_provider
  ON public.reserved_accounts(user_id, provider_id);

ALTER INDEX IF EXISTS idx_monnify_user RENAME TO idx_reserved_accounts_user;
ALTER INDEX IF EXISTS idx_monnify_acct_ref RENAME TO idx_reserved_accounts_acct_ref;
ALTER INDEX IF EXISTS idx_monnify_acct_num RENAME TO idx_reserved_accounts_acct_num;

CREATE OR REPLACE VIEW public.monnify_reserved_accounts AS
  SELECT * FROM public.reserved_accounts WHERE provider_id = 'monnify';

COMMENT ON VIEW public.monnify_reserved_accounts IS
  'Backward-compatible view. Prefer reserved_accounts with provider_id.';

-- ── PSP event audit trail ──
CREATE TABLE public.psp_events (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  transaction_id UUID REFERENCES public.transactions(id) ON DELETE SET NULL,
  provider_id TEXT NOT NULL REFERENCES public.psp_providers(id),
  direction TEXT NOT NULL CHECK (direction IN ('inbound', 'outbound')),
  event_type TEXT NOT NULL,
  status TEXT,
  provider_status TEXT,
  reference TEXT,
  provider_ref TEXT,
  request_summary JSONB,
  response_summary JSONB,
  error_message TEXT,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE INDEX idx_psp_events_txn ON public.psp_events(transaction_id);
CREATE INDEX idx_psp_events_provider ON public.psp_events(provider_id);
CREATE INDEX idx_psp_events_reference ON public.psp_events(reference) WHERE reference IS NOT NULL;
CREATE INDEX idx_psp_events_created ON public.psp_events(created_at DESC);

ALTER TABLE public.psp_events ENABLE ROW LEVEL SECURITY;

CREATE POLICY "Admins can view psp events"
  ON public.psp_events FOR SELECT TO authenticated
  USING (public.is_any_admin(auth.uid()));

CREATE POLICY "Users can view own reserved accounts"
  ON public.reserved_accounts FOR SELECT TO authenticated
  USING (user_id IN (SELECT id FROM public.users WHERE auth_id = auth.uid()));

CREATE POLICY "Admins can view all reserved accounts"
  ON public.reserved_accounts FOR SELECT TO authenticated
  USING (public.is_any_admin(auth.uid()));

-- ── Relax transactions.provider CHECK (registry-driven) ──
ALTER TABLE public.transactions DROP CONSTRAINT IF EXISTS transactions_provider_check;

-- ── RPCs ──
CREATE OR REPLACE FUNCTION public.get_wallet_funding_provider()
RETURNS text
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path = public
AS $$
  SELECT wallet_funding_provider_id FROM public.platform_settings WHERE id = 1;
$$;

CREATE OR REPLACE FUNCTION public.get_disbursement_provider()
RETURNS text
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path = public
AS $$
  SELECT disbursement_provider_id FROM public.platform_settings WHERE id = 1;
$$;

CREATE OR REPLACE FUNCTION public.get_platform_payment_settings()
RETURNS jsonb
LANGUAGE plpgsql
STABLE
SECURITY DEFINER
SET search_path = public
AS $$
BEGIN
  IF NOT public.is_any_admin(auth.uid()) THEN
    RAISE EXCEPTION 'Admin access required';
  END IF;

  RETURN (
    SELECT jsonb_build_object(
      'wallet_funding_provider_id', ps.wallet_funding_provider_id,
      'disbursement_provider_id', ps.disbursement_provider_id,
      'psp_env', ps.psp_env,
      'updated_at', ps.updated_at
    )
    FROM public.platform_settings ps
    WHERE ps.id = 1
  );
END;
$$;

CREATE OR REPLACE FUNCTION public.set_wallet_funding_provider(_provider_id text)
RETURNS void
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  _admin_id uuid := auth.uid();
BEGIN
  IF NOT public.is_any_admin(_admin_id) THEN
    RAISE EXCEPTION 'Admin access required';
  END IF;

  IF NOT EXISTS (
    SELECT 1 FROM public.psp_providers
    WHERE id = _provider_id
      AND status IN ('active', 'sandbox_only')
      AND 'wallet_funding' = ANY(capabilities)
  ) THEN
    RAISE EXCEPTION 'Invalid or unsupported wallet funding provider: %', _provider_id;
  END IF;

  UPDATE public.platform_settings
  SET wallet_funding_provider_id = _provider_id,
      updated_at = now(),
      updated_by = _admin_id
  WHERE id = 1;

  PERFORM public.log_admin_action(
    _admin_id, 'set_wallet_funding_provider', 'platform_settings', NULL,
    jsonb_build_object('provider_id', _provider_id)
  );
END;
$$;

CREATE OR REPLACE FUNCTION public.set_disbursement_provider(_provider_id text)
RETURNS void
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  _admin_id uuid := auth.uid();
BEGIN
  IF NOT public.is_any_admin(_admin_id) THEN
    RAISE EXCEPTION 'Admin access required';
  END IF;

  IF NOT EXISTS (
    SELECT 1 FROM public.psp_providers
    WHERE id = _provider_id
      AND status IN ('active', 'sandbox_only')
      AND 'disbursement' = ANY(capabilities)
  ) THEN
    RAISE EXCEPTION 'Invalid or unsupported disbursement provider: %', _provider_id;
  END IF;

  UPDATE public.platform_settings
  SET disbursement_provider_id = _provider_id,
      updated_at = now(),
      updated_by = _admin_id
  WHERE id = 1;

  PERFORM public.log_admin_action(
    _admin_id, 'set_disbursement_provider', 'platform_settings', NULL,
    jsonb_build_object('provider_id', _provider_id)
  );
END;
$$;

GRANT EXECUTE ON FUNCTION public.get_wallet_funding_provider() TO authenticated;
GRANT EXECUTE ON FUNCTION public.get_disbursement_provider() TO authenticated;
GRANT EXECUTE ON FUNCTION public.get_platform_payment_settings() TO authenticated;
GRANT EXECUTE ON FUNCTION public.set_wallet_funding_provider(text) TO authenticated;
GRANT EXECUTE ON FUNCTION public.set_disbursement_provider(text) TO authenticated;
