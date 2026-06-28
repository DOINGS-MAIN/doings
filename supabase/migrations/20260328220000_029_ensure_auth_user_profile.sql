-- Backfill public.users (+ NGN/USDT wallets via tr_create_wallets_on_user) when Auth exists
-- but no profile row (e.g. created before signup trigger or trigger error).

CREATE OR REPLACE FUNCTION public.ensure_auth_user_profile()
RETURNS uuid
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_auth uuid := auth.uid();
  v_id uuid;
BEGIN
  IF v_auth IS NULL THEN
    RAISE EXCEPTION 'not authenticated' USING ERRCODE = '28000';
  END IF;

  SELECT id INTO v_id FROM public.users WHERE auth_id = v_auth LIMIT 1;
  IF FOUND THEN
    RETURN v_id;
  END IF;

  INSERT INTO public.users (auth_id, phone, email, full_name, username)
  SELECT
    au.id,
    CASE
      WHEN au.phone IS NOT NULL AND btrim(au.phone) <> '' THEN left(btrim(au.phone), 15)
      ELSE left(replace(au.id::text, '-', ''), 15)
    END,
    au.email,
    coalesce(nullif(btrim(coalesce(au.raw_user_meta_data->>'full_name', '')), ''), 'Member'),
    nullif(lower(btrim(coalesce(au.raw_user_meta_data->>'username', ''))), '')
  FROM auth.users au
  WHERE au.id = v_auth
  RETURNING id INTO v_id;

  RETURN v_id;
EXCEPTION
  WHEN unique_violation THEN
    SELECT id INTO v_id FROM public.users WHERE auth_id = v_auth LIMIT 1;
    IF v_id IS NULL THEN
      RAISE;
    END IF;
    RETURN v_id;
END;
$$;

REVOKE ALL ON FUNCTION public.ensure_auth_user_profile() FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.ensure_auth_user_profile() TO authenticated;
