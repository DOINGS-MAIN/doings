-- Sign-up: persist username from auth metadata; build full_name from first + last when needed.

CREATE OR REPLACE FUNCTION public.handle_new_auth_user()
RETURNS TRIGGER AS $$
DECLARE
  v_full text;
  v_user text;
  v_first text;
  v_last text;
BEGIN
  v_first := NULLIF(btrim(COALESCE(NEW.raw_user_meta_data->>'first_name', '')), '');
  v_last := NULLIF(btrim(COALESCE(NEW.raw_user_meta_data->>'last_name', '')), '');
  v_full := NULLIF(btrim(COALESCE(NEW.raw_user_meta_data->>'full_name', '')), '');

  IF v_full IS NULL THEN
    v_full := NULLIF(trim(CONCAT_WS(' ', v_first, v_last)), '');
  END IF;

  IF v_full IS NULL THEN
    v_full := NULLIF(btrim(COALESCE(NEW.raw_user_meta_data->>'name', '')), '');
  END IF;

  IF v_full IS NULL THEN
    v_full := '';
  END IF;

  v_user := lower(btrim(COALESCE(NEW.raw_user_meta_data->>'username', '')));
  IF v_user = '' THEN
    v_user := NULL;
  END IF;

  INSERT INTO public.users (auth_id, phone, email, full_name, username)
  VALUES (
    NEW.id,
    NULLIF(btrim(COALESCE(NEW.phone::text, '')), ''),
    NEW.email,
    v_full,
    v_user
  )
  ON CONFLICT (auth_id) DO NOTHING;
  RETURN NEW;
END;
$$ LANGUAGE plpgsql SECURITY DEFINER SET search_path = public;
