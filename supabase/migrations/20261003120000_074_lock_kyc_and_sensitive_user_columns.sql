-- SECURITY: any signed-in user could raise their own KYC level without Dojah:
--   * "Users can update own profile" has no column restriction, so
--     `update users set kyc_level = 2` (or status / PIN lock fields) worked from the browser;
--   * "Users can insert own kyc records" allowed inserting {level: 2, status: 'verified'}, and the
--     AFTER INSERT trigger then bumped users.kyc_level.
-- Live check before this migration: all 11 level-2 users have a genuine Dojah verification row.
--
-- Clients (current app + new app) only write full_name, avatar_url and avatar_data directly;
-- usernames, PINs, KYC and admin actions go through SECURITY DEFINER RPCs / service-role edge
-- functions, which column privileges and RLS don't restrict.

REVOKE UPDATE ON public.users FROM anon, authenticated;
GRANT UPDATE (full_name, avatar_url, avatar_data) ON public.users TO authenticated;

DROP POLICY IF EXISTS "Users can insert own kyc records" ON public.kyc_verifications;
REVOKE INSERT, UPDATE, DELETE ON public.kyc_verifications FROM anon, authenticated;
