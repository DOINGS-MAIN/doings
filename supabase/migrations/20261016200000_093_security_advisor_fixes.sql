-- Security advisor fixes (2026-10-16). With only the public anon key, anyone could read, change or
-- wipe the admin audit log and the transaction flags (RLS off, default grants), forge audit entries
-- through log_admin_action, and read or write reserved bank accounts through the
-- monnify_reserved_accounts view (it ran as its owner, skipping reserved_accounts RLS).
--
-- Every legitimate path keeps working: writers are SECURITY DEFINER functions and triggers owned by
-- postgres (bypasses RLS), and readers are edge functions using service_role.

ALTER TABLE public.admin_audit_log ENABLE ROW LEVEL SECURITY;
REVOKE ALL ON public.admin_audit_log FROM anon, authenticated;

ALTER TABLE public.transaction_flags ENABLE ROW LEVEL SECURITY;
REVOKE ALL ON public.transaction_flags FROM anon, authenticated;

-- Unused backward-compatible view (migration 031): run as the caller and close it to API roles.
ALTER VIEW public.monnify_reserved_accounts SET (security_invoker = true);
REVOKE ALL ON public.monnify_reserved_accounts FROM anon, authenticated;

-- Only the server writes audit entries (admin edge function via service_role; other SECURITY
-- DEFINER functions call it as their owner).
REVOKE ALL ON FUNCTION public.log_admin_action(uuid, varchar, varchar, uuid, jsonb, inet) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.log_admin_action(uuid, varchar, varchar, uuid, jsonb, inet) TO service_role;
