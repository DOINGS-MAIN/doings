-- Username: availability check, profile update, signup uniqueness guard

CREATE OR REPLACE FUNCTION public.normalize_username(p_raw text)
RETURNS text
LANGUAGE sql
IMMUTABLE
AS $$
  SELECT lower(regexp_replace(btrim(COALESCE(p_raw, '')), '^@+', ''));
$$;

CREATE OR REPLACE FUNCTION public.is_username_available(
  p_username text,
  p_exclude_user_id uuid DEFAULT NULL
)
RETURNS boolean
LANGUAGE plpgsql
STABLE
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_norm text;
BEGIN
  v_norm := public.normalize_username(p_username);
  IF v_norm IS NULL OR v_norm = '' OR v_norm !~ '^[a-z0-9_]{3,30}$' THEN
    RETURN false;
  END IF;

  RETURN NOT EXISTS (
    SELECT 1
    FROM public.users u
    WHERE u.username = v_norm
      AND (p_exclude_user_id IS NULL OR u.id <> p_exclude_user_id)
  );
END;
$$;

CREATE OR REPLACE FUNCTION public.set_username(p_username text)
RETURNS void
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_norm text;
  v_user_id uuid;
  v_current text;
BEGIN
  v_norm := public.normalize_username(p_username);
  IF v_norm IS NULL OR v_norm = '' OR v_norm !~ '^[a-z0-9_]{3,30}$' THEN
    RAISE EXCEPTION 'INVALID_USERNAME'
      USING MESSAGE = 'Username must be 3–30 characters: letters, numbers, underscore only';
  END IF;

  v_user_id := public.ensure_auth_user_profile();

  SELECT username INTO v_current FROM public.users WHERE id = v_user_id;
  IF v_current IS NOT NULL AND v_current = v_norm THEN
    RETURN;
  END IF;

  IF NOT public.is_username_available(v_norm, v_user_id) THEN
    RAISE EXCEPTION 'USERNAME_TAKEN' USING MESSAGE = 'This username is already taken';
  END IF;

  UPDATE public.users
  SET username = v_norm,
      updated_at = now()
  WHERE id = v_user_id;
END;
$$;

-- Sign-up trigger: reject duplicate usernames before unique constraint error
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

  v_user := public.normalize_username(COALESCE(NEW.raw_user_meta_data->>'username', ''));
  IF v_user = '' THEN
    v_user := NULL;
  ELSIF v_user !~ '^[a-z0-9_]{3,30}$' THEN
    RAISE EXCEPTION 'INVALID_USERNAME'
      USING MESSAGE = 'Username must be 3–30 characters: letters, numbers, underscore only';
  ELSIF NOT public.is_username_available(v_user, NULL) THEN
    RAISE EXCEPTION 'USERNAME_TAKEN' USING MESSAGE = 'This username is already taken';
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

GRANT EXECUTE ON FUNCTION public.is_username_available(text, uuid) TO anon, authenticated;
GRANT EXECUTE ON FUNCTION public.set_username(text) TO authenticated;
