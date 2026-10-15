-- Helpers for rolled-back floor tests (pg_temp: gone at the end of the session).
CREATE OR REPLACE FUNCTION pg_temp.mk_user(p_email text, p_balance_kobo bigint) RETURNS uuid
LANGUAGE plpgsql AS $$
DECLARE v_auth uuid := gen_random_uuid(); v_id uuid;
BEGIN
  INSERT INTO auth.users (id, instance_id, aud, role, email, email_confirmed_at, raw_app_meta_data, raw_user_meta_data, created_at, updated_at)
  VALUES (v_auth, '00000000-0000-0000-0000-000000000000', 'authenticated', 'authenticated', p_email, now(), '{}', '{}', now(), now());
  SELECT id INTO v_id FROM public.users WHERE auth_id = v_auth;
  UPDATE public.wallets SET balance = p_balance_kobo, locked_balance = 0 WHERE user_id = v_id AND currency = 'NGN';
  RETURN v_id;
END $$;

CREATE OR REPLACE FUNCTION pg_temp.mk_event(p_host uuid, p_private boolean DEFAULT false) RETURNS uuid
LANGUAGE sql AS $$
  INSERT INTO public.events (host_id, title, type, event_code, status, is_private)
  VALUES (p_host, 'Floor test', 'party', upper(substr(md5(random()::text), 1, 6)), 'live', p_private)
  RETURNING id
$$;

CREATE OR REPLACE FUNCTION pg_temp.auth_as(p_user uuid) RETURNS void
LANGUAGE sql AS $$
  SELECT set_config('request.jwt.claims',
    json_build_object('sub', (SELECT auth_id FROM public.users WHERE id = p_user), 'role', 'authenticated')::text, true)
$$;

CREATE OR REPLACE FUNCTION pg_temp.wallet(p_user uuid) RETURNS TABLE (balance bigint, locked bigint)
LANGUAGE sql AS $$ SELECT balance, locked_balance FROM public.wallets WHERE user_id = p_user AND currency = 'NGN' $$;
