-- Email OTP login: allow users without a phone row value (avoid duplicate '' on UNIQUE phone).

UPDATE public.users SET phone = NULL WHERE btrim(COALESCE(phone, '')) = '';

ALTER TABLE public.users DROP CONSTRAINT IF EXISTS users_phone_key;

ALTER TABLE public.users ALTER COLUMN phone DROP NOT NULL;

CREATE UNIQUE INDEX idx_users_phone_unique
  ON public.users (phone)
  WHERE phone IS NOT NULL AND btrim(phone) <> '';

-- Signup hook: store email from auth; phone only when present (SMS users / linked phone).
CREATE OR REPLACE FUNCTION public.handle_new_auth_user()
RETURNS TRIGGER AS $$
BEGIN
  INSERT INTO public.users (auth_id, phone, email, full_name)
  VALUES (
    NEW.id,
    NULLIF(btrim(COALESCE(NEW.phone::text, '')), ''),
    NEW.email,
    COALESCE(NEW.raw_user_meta_data->>'full_name', '')
  )
  ON CONFLICT (auth_id) DO NOTHING;
  RETURN NEW;
END;
$$ LANGUAGE plpgsql SECURITY DEFINER SET search_path = public;
