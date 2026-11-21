-- 116: the debit behind a share follows the admin switch, like the transfer function does.
-- Run as: BEGIN; migration 116; tests/ads/_setup.sql; this file; ROLLBACK.

CREATE FUNCTION pg_temp.share(p_from uuid, p_to uuid, p_amount bigint) RETURNS text LANGUAGE plpgsql AS $$
BEGIN
  PERFORM public.internal_transfer_checked(
    (SELECT id FROM public.wallets WHERE user_id = p_from AND currency = 'NGN'),
    (SELECT id FROM public.wallets WHERE user_id = p_to AND currency = 'NGN'),
    p_from, p_to, p_amount, 's116', 20000000::bigint, NULL::text);
  RETURN 'OK';
EXCEPTION WHEN OTHERS THEN RETURN SQLERRM;
END $$;

DO $$
DECLARE
  l1 uuid := pg_temp.mk_user('s116-l1@test.local', 100000);
  l2 uuid := pg_temp.mk_user('s116-l2@test.local', 100000);
  l0 uuid := pg_temp.mk_user('s116-l0@test.local', 100000);
  rx uuid := pg_temp.mk_user('s116-rx@test.local', 0);
  r text;
BEGIN
  UPDATE public.users SET kyc_level = 2 WHERE id = l2;
  UPDATE public.users SET kyc_level = 0 WHERE id = l0;

  -- switch off: a verified email is enough
  UPDATE public.platform_settings SET share_requires_identity = false WHERE id = 1;
  r := pg_temp.share(l1, rx, 20000);
  ASSERT r = 'OK', 'email-only account shares when the switch is off: ' || r;
  ASSERT (SELECT balance FROM public.wallets WHERE user_id = l1 AND currency = 'NGN') = 80000, 'sender is debited';
  ASSERT (SELECT balance FROM public.wallets WHERE user_id = rx AND currency = 'NGN') = 20000, 'receiver is credited';
  r := pg_temp.share(l0, rx, 20000);
  ASSERT r LIKE 'Verify your email%', 'an unverified email still cannot share: ' || r;
  ASSERT (SELECT balance FROM public.wallets WHERE user_id = l0 AND currency = 'NGN') = 100000, 'and nothing moves';

  -- switch on: BVN + selfie needed
  UPDATE public.platform_settings SET share_requires_identity = true WHERE id = 1;
  r := pg_temp.share(l1, rx, 20000);
  ASSERT r LIKE 'Complete identity verification%', 'email-only account is refused when the switch is on: ' || r;
  ASSERT (SELECT balance FROM public.wallets WHERE user_id = l1 AND currency = 'NGN') = 80000, 'and nothing moves';
  r := pg_temp.share(l2, rx, 20000);
  ASSERT r = 'OK', 'a fully verified account shares when the switch is on: ' || r;

  -- other debits keep their rule: a payout-type debit still needs level 2 whatever the switch says
  UPDATE public.platform_settings SET share_requires_identity = false WHERE id = 1;
  BEGIN
    PERFORM public.debit_wallet((SELECT id FROM public.wallets WHERE user_id = l1 AND currency = 'NGN'), l1, 1000::bigint, 0::bigint, 'withdrawal'::public.transaction_type);
    r := 'OK';
  EXCEPTION WHEN OTHERS THEN r := SQLERRM; END;
  ASSERT r LIKE 'Complete identity verification%', 'withdrawal debit still needs level 2: ' || r;
END $$;
SELECT 'PASS 13_share_debit_follows_switch' AS result;
