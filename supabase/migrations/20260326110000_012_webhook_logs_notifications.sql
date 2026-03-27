-- Migration 012: Webhook Logs & Notifications
-- ================================================

CREATE TABLE public.webhook_logs (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  provider VARCHAR(20) NOT NULL,
  event_type VARCHAR(100),
  payload JSONB NOT NULL,
  headers JSONB,
  signature VARCHAR(512),
  signature_valid BOOLEAN,
  processed BOOLEAN DEFAULT false,
  processing_error TEXT,
  idempotency_key VARCHAR(255),
  ip_address INET,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  processed_at TIMESTAMPTZ
);

CREATE INDEX idx_webhook_provider ON public.webhook_logs(provider);
CREATE INDEX idx_webhook_processed ON public.webhook_logs(processed) WHERE processed = false;
CREATE INDEX idx_webhook_idempotency ON public.webhook_logs(idempotency_key) WHERE idempotency_key IS NOT NULL;
CREATE INDEX idx_webhook_created ON public.webhook_logs(created_at DESC);

CREATE TABLE public.notifications (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id UUID NOT NULL REFERENCES public.users(id) ON DELETE CASCADE,
  type VARCHAR(50) NOT NULL,
  title VARCHAR(200) NOT NULL,
  body TEXT,
  data JSONB,
  read BOOLEAN DEFAULT false,
  read_at TIMESTAMPTZ,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE INDEX idx_notif_user ON public.notifications(user_id);
CREATE INDEX idx_notif_unread ON public.notifications(user_id, read) WHERE read = false;
CREATE INDEX idx_notif_created ON public.notifications(created_at DESC);
