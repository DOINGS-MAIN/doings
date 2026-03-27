-- Migration 016: Admin Audit Log
-- ================================================

CREATE TABLE public.admin_audit_log (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  admin_user_id UUID NOT NULL REFERENCES auth.users(id),
  action VARCHAR(100) NOT NULL,
  target_type VARCHAR(50) NOT NULL,
  target_id UUID,
  details JSONB,
  ip_address INET,
  user_agent TEXT,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE INDEX idx_audit_admin ON public.admin_audit_log(admin_user_id);
CREATE INDEX idx_audit_action ON public.admin_audit_log(action);
CREATE INDEX idx_audit_target ON public.admin_audit_log(target_type, target_id);
CREATE INDEX idx_audit_created ON public.admin_audit_log(created_at DESC);

CREATE OR REPLACE FUNCTION public.log_admin_action(
  p_admin_id UUID,
  p_action VARCHAR(100),
  p_target_type VARCHAR(50),
  p_target_id UUID DEFAULT NULL,
  p_details JSONB DEFAULT NULL,
  p_ip_address INET DEFAULT NULL
)
RETURNS UUID AS $$
DECLARE
  v_id UUID;
BEGIN
  INSERT INTO public.admin_audit_log (
    admin_user_id, action, target_type, target_id, details, ip_address
  ) VALUES (
    p_admin_id, p_action, p_target_type, p_target_id, p_details, p_ip_address
  )
  RETURNING id INTO v_id;

  RETURN v_id;
END;
$$ LANGUAGE plpgsql SECURITY DEFINER;
