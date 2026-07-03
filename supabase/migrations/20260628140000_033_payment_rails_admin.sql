-- Migration 033: Payment rails admin RPCs
-- =================================================================

ALTER TABLE public.psp_providers ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS "Admins can view psp providers" ON public.psp_providers;
CREATE POLICY "Admins can view psp providers"
  ON public.psp_providers FOR SELECT TO authenticated
  USING (public.is_any_admin(auth.uid()));

CREATE OR REPLACE FUNCTION public.list_psp_providers()
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

  RETURN COALESCE(
    (
      SELECT jsonb_agg(
        jsonb_build_object(
          'id', p.id,
          'display_name', p.display_name,
          'capabilities', p.capabilities,
          'status', p.status,
          'config_schema', p.config_schema,
          'updated_at', p.updated_at
        )
        ORDER BY p.display_name
      )
      FROM public.psp_providers p
    ),
    '[]'::jsonb
  );
END;
$$;

CREATE OR REPLACE FUNCTION public.set_psp_env(_psp_env text)
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

  IF _psp_env NOT IN ('sandbox', 'production') THEN
    RAISE EXCEPTION 'Invalid PSP environment: %', _psp_env;
  END IF;

  UPDATE public.platform_settings
  SET psp_env = _psp_env,
      updated_at = now(),
      updated_by = _admin_id
  WHERE id = 1;

  PERFORM public.log_admin_action(
    _admin_id, 'set_psp_env', 'platform_settings', NULL,
    jsonb_build_object('psp_env', _psp_env)
  );
END;
$$;

GRANT EXECUTE ON FUNCTION public.list_psp_providers() TO authenticated;
GRANT EXECUTE ON FUNCTION public.set_psp_env(text) TO authenticated;
