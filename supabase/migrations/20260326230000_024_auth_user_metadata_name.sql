-- Google (and other OAuth) providers often set `name` instead of `full_name` in raw_user_meta_data.

CREATE OR REPLACE FUNCTION public.handle_new_auth_user()
RETURNS TRIGGER AS $$
BEGIN
  INSERT INTO public.users (auth_id, phone, email, full_name)
  VALUES (
    NEW.id,
    NULLIF(btrim(COALESCE(NEW.phone::text, '')), ''),
    NEW.email,
    COALESCE(
      NULLIF(btrim(COALESCE(NEW.raw_user_meta_data->>'full_name', '')), ''),
      NULLIF(btrim(COALESCE(NEW.raw_user_meta_data->>'name', '')), ''),
      ''
    )
  )
  ON CONFLICT (auth_id) DO NOTHING;
  RETURN NEW;
END;
$$ LANGUAGE plpgsql SECURITY DEFINER SET search_path = public;
