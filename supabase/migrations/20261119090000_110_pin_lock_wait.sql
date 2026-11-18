-- 110: the app can tell a person how long their PIN lock lasts.
--
-- Locks grow from 15 minutes to 24 hours (108). Paying reports the wait through the edge functions, but
-- changing the PIN in Profile goes straight to change_transaction_pin, which only answers PIN_LOCKED, so
-- the app could say no more than "try again later". The PIN columns are not readable by clients (106);
-- this returns just the seconds left on the caller's own lock, 0 when there is none.
CREATE FUNCTION public.transaction_pin_lock_seconds()
RETURNS integer
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path = public
AS $$
  SELECT COALESCE((
    SELECT GREATEST(0, ceil(extract(epoch FROM (u.transaction_pin_locked_until - now()))))::integer
    FROM public.users u
    WHERE u.auth_id = auth.uid()
  ), 0)
$$;
REVOKE ALL ON FUNCTION public.transaction_pin_lock_seconds() FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.transaction_pin_lock_seconds() TO authenticated, service_role;
