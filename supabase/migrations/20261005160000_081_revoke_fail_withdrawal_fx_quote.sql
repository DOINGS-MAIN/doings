-- SECURITY: fail_withdrawal and create_fx_quote were still executable by anon/authenticated
-- (076 missed them). fail_withdrawal releases a pending withdrawal's lock for any transaction id,
-- so a user could free funds while the payout is still being paid (double spend). create_fx_quote
-- takes a caller-chosen user id. Only edge functions (service role) call either.
REVOKE ALL ON FUNCTION public.fail_withdrawal(UUID) FROM PUBLIC, anon, authenticated;
REVOKE ALL ON FUNCTION public.create_fx_quote(UUID, TEXT, BIGINT) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.fail_withdrawal(UUID) TO service_role;
GRANT EXECUTE ON FUNCTION public.create_fx_quote(UUID, TEXT, BIGINT) TO service_role;
