-- Migration 018: Webhook Idempotency Index
-- ================================================
-- Ensures each provider + idempotency key is processed once.

CREATE UNIQUE INDEX ux_webhook_provider_idempotency
  ON public.webhook_logs(provider, idempotency_key)
  WHERE idempotency_key IS NOT NULL;
