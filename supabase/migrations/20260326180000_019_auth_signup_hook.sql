-- Migration 019: Auth Signup Hook
-- ================================================
-- When a new user signs up via Supabase Auth (phone OTP),
-- auto-create a public.users row linked via auth_id.
-- The existing tr_create_wallets_on_user trigger then
-- auto-creates NGN + USDT wallets.

CREATE OR REPLACE FUNCTION public.handle_new_auth_user()
RETURNS TRIGGER AS $$
BEGIN
  INSERT INTO public.users (auth_id, phone, email, full_name)
  VALUES (
    NEW.id,
    COALESCE(NEW.phone, ''),
    NEW.email,
    COALESCE(NEW.raw_user_meta_data->>'full_name', '')
  )
  ON CONFLICT (auth_id) DO NOTHING;
  RETURN NEW;
END;
$$ LANGUAGE plpgsql SECURITY DEFINER SET search_path = public;

CREATE TRIGGER tr_on_auth_user_created
  AFTER INSERT ON auth.users
  FOR EACH ROW EXECUTE FUNCTION public.handle_new_auth_user();
