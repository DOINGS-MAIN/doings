-- 111: two-step sign-in for super admins (security release 3, part B).
--
-- A super admin's password alone opened everything. Super admins now add an authenticator app
-- (Supabase TOTP); a session that has passed the code carries aal2 in its token. Once the rule below is
-- switched on, a super admin session without it is not a super admin: here for calls made straight to
-- the database, and in the admin function (adminTwoStep.ts) for everything else.
--
-- The rule ships OFF. It is switched on from the Team page (admin function, `team/two-step`), which
-- insists on two super admins with a working authenticator first, so nobody is locked out.
-- Emergency off switch, from the SQL editor:
--   UPDATE public.platform_settings SET admin_two_step_required = false WHERE id = 1;
--
-- RELEASE ORDER: this migration, then the admin function, then the admin app.
-- BEFORE APPLYING: has_admin_role is re-created from 003; diff it against
--   pg_get_functiondef('public.has_admin_role(uuid, public.admin_role)'::regprocedure)

ALTER TABLE public.platform_settings
  ADD COLUMN IF NOT EXISTS admin_two_step_required BOOLEAN NOT NULL DEFAULT false;

CREATE OR REPLACE FUNCTION public.has_admin_role(_user_id UUID, _role admin_role)
RETURNS BOOLEAN
LANGUAGE sql STABLE SECURITY DEFINER
SET search_path = public
AS $$
  SELECT EXISTS (
    SELECT 1
    FROM public.admin_roles
    WHERE user_id = _user_id
      AND role = _role
      AND status = 'active'
  )
  -- 111: a super admin asking about themselves from a signed-in session needs the two-step code once
  -- the rule is on. Server-side callers (no session, auth.uid() is NULL) are checked by their function.
  AND NOT (
    _role = 'super_admin'
    AND auth.uid() IS NOT NULL
    AND _user_id = auth.uid()
    AND COALESCE(auth.jwt() ->> 'aal', 'aal1') <> 'aal2'
    AND COALESCE((SELECT admin_two_step_required FROM public.platform_settings WHERE id = 1), false)
  )
$$;
