-- SECURITY: every core money function was EXECUTE-able by anon and authenticated (Supabase's
-- default privileges grant new public functions to both; no migration revoked them). All are
-- SECURITY DEFINER and trust their arguments, so anyone with the anon key could call e.g.
-- credit_wallet (mint), debit_wallet / internal_transfer (move any user's funds),
-- admin_refund_transaction or complete_withdrawal directly.
--
-- Neither app calls these over PostgREST; edge functions call them with the service role, and
-- definer functions calling each other run as the owner — both unaffected by these REVOKEs.

REVOKE ALL ON FUNCTION public.admin_refund_transaction(uuid,uuid,text) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.admin_refund_transaction(uuid,uuid,text) TO service_role;
REVOKE ALL ON FUNCTION public.complete_withdrawal(uuid) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.complete_withdrawal(uuid) TO service_role;
REVOKE ALL ON FUNCTION public.create_giveaway_funded(uuid,text,bigint,bigint,giveaway_type,uuid,boolean,boolean,text) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.create_giveaway_funded(uuid,text,bigint,bigint,giveaway_type,uuid,boolean,boolean,text) TO service_role;
REVOKE ALL ON FUNCTION public.create_spray_hold(uuid,uuid,bigint,integer,integer,jsonb,integer) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.create_spray_hold(uuid,uuid,bigint,integer,integer,jsonb,integer) TO service_role;
REVOKE ALL ON FUNCTION public.credit_wallet(uuid,uuid,bigint,bigint,transaction_type,text,character varying,character varying,character varying,jsonb) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.credit_wallet(uuid,uuid,bigint,bigint,transaction_type,text,character varying,character varying,character varying,jsonb) TO service_role;
REVOKE ALL ON FUNCTION public.debit_wallet(uuid,uuid,bigint,bigint,transaction_type,text,character varying,character varying,jsonb) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.debit_wallet(uuid,uuid,bigint,bigint,transaction_type,text,character varying,character varying,jsonb) TO service_role;
REVOKE ALL ON FUNCTION public.execute_fx_swap(uuid,uuid) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.execute_fx_swap(uuid,uuid) TO service_role;
REVOKE ALL ON FUNCTION public.internal_transfer(uuid,uuid,uuid,uuid,bigint,bigint,text,transaction_type) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.internal_transfer(uuid,uuid,uuid,uuid,bigint,bigint,text,transaction_type) TO service_role;
REVOKE ALL ON FUNCTION public.lock_withdrawal(uuid,uuid,bigint,bigint,transaction_type,text,character varying,character varying,character varying,jsonb) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.lock_withdrawal(uuid,uuid,bigint,bigint,transaction_type,text,character varying,character varying,character varying,jsonb) TO service_role;
REVOKE ALL ON FUNCTION public.record_event_spray(uuid,uuid,bigint,integer,integer,jsonb) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.record_event_spray(uuid,uuid,bigint,integer,integer,jsonb) TO service_role;
REVOKE ALL ON FUNCTION public.redeem_giveaway_code(uuid,text) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.redeem_giveaway_code(uuid,text) TO service_role;
REVOKE ALL ON FUNCTION public.settle_spray_hold(uuid,uuid,spray_settlement_type,bigint) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.settle_spray_hold(uuid,uuid,spray_settlement_type,bigint) TO service_role;
REVOKE ALL ON FUNCTION public.stop_giveaway_funded(uuid,uuid) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.stop_giveaway_funded(uuid,uuid) TO service_role;
