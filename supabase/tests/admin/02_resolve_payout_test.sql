-- 096: admin_resolve_payout settles a stuck payout through the existing settle functions, under a
-- row lock, with guards; only service_role may call it.

CREATE FUNCTION pg_temp.err(q text) RETURNS text LANGUAGE plpgsql AS $$
BEGIN EXECUTE q; RETURN NULL; EXCEPTION WHEN OTHERS THEN RETURN SQLERRM; END $$;

CREATE TEMP TABLE fx AS
SELECT w.id AS wallet_id, w.user_id, u.auth_id
FROM public.wallets w JOIN public.users u ON u.id = w.user_id
WHERE w.user_id = '53f63182-22be-4f1f-aa78-c24d52ad4f3d' AND w.currency = 'NGN';

-- Three open payouts of 3,000 kobo each, held in locked_balance as the real flow does.
UPDATE public.wallets SET balance = balance + 10000, locked_balance = locked_balance + 9000
WHERE id = (SELECT wallet_id FROM fx);
INSERT INTO public.transactions (wallet_id, user_id, currency, type, amount, net_amount, status, provider, idempotency_key, description, metadata)
SELECT fx.wallet_id, fx.user_id, 'NGN', 'withdrawal', -3000, -3000, 'processing', 'internal', 'test-096-' || v.k, 'test 096', v.meta
FROM fx CROSS JOIN (VALUES
  ('sale', '{"kind":"bundle_sale","bundles":3}'::jsonb),
  ('wd',   '{"needs_review":true}'::jsonb),
  ('ok',   '{"last_provider_check":{"status":"terminal_success"}}'::jsonb)
) AS v(k, meta);
INSERT INTO public.transactions (wallet_id, user_id, currency, type, amount, net_amount, status, provider, idempotency_key, description)
SELECT wallet_id, user_id, 'NGN', 'deposit', 100, 100, 'pending', 'internal', 'test-096-dep', 'test 096' FROM fx;

CREATE TEMP TABLE ids AS
SELECT replace(idempotency_key, 'test-096-', '') AS k, id FROM public.transactions WHERE idempotency_key LIKE 'test-096-%';
CREATE TEMP TABLE w0 AS SELECT balance, locked_balance FROM public.wallets WHERE id = (SELECT wallet_id FROM fx);

DO $$
DECLARE
  a uuid := (SELECT auth_id FROM fx);
  sale uuid := (SELECT id FROM ids WHERE k = 'sale');
  wd uuid := (SELECT id FROM ids WHERE k = 'wd');
  ok uuid := (SELECT id FROM ids WHERE k = 'ok');
  dep uuid := (SELECT id FROM ids WHERE k = 'dep');
  r jsonb; b0 bigint := (SELECT balance FROM w0); l0 bigint := (SELECT locked_balance FROM w0);
BEGIN
  -- guards
  ASSERT pg_temp.err(format('SELECT public.admin_resolve_payout(%L, %L, %L, %L)', dep, 'paid', a, 'x')) = 'Payout not found', 'non-withdrawal refused';
  ASSERT pg_temp.err(format('SELECT public.admin_resolve_payout(%L, %L, %L, %L)', gen_random_uuid(), 'paid', a, 'x')) = 'Payout not found', 'missing refused';
  ASSERT pg_temp.err(format('SELECT public.admin_resolve_payout(%L, %L, %L, %L)', wd, 'maybe', a, 'x')) = 'Outcome must be paid or failed', 'bad outcome';
  ASSERT pg_temp.err(format('SELECT public.admin_resolve_payout(%L, %L, %L, %L)', wd, 'failed', a, '   ')) = 'A reason is required', 'blank reason';
  ASSERT pg_temp.err(format('SELECT public.admin_resolve_payout(%L, %L, %L, %L)', ok, 'failed', a, 'x')) = 'The provider reported this payout as paid', 'provider success blocks failed';

  -- sale marked paid: completed, balance and lock both drop by 3000
  r := public.admin_resolve_payout(sale, 'paid', a, 'Bank confirmed by phone');
  ASSERT r->>'status' = 'completed', 'sale completed';
  -- plain withdrawal marked failed: failed, only the lock drops (money back to the user)
  r := public.admin_resolve_payout(wd, 'failed', a, 'Provider says never sent');
  ASSERT r->>'status' = 'failed', 'withdrawal failed';
  -- provider-paid one can still be marked paid
  r := public.admin_resolve_payout(ok, 'paid', a, 'Provider confirmed');
  ASSERT r->>'status' = 'completed', 'ok completed';

  ASSERT (SELECT balance FROM public.wallets WHERE id = (SELECT wallet_id FROM fx)) = b0 - 6000, 'balance: two completed';
  ASSERT (SELECT locked_balance FROM public.wallets WHERE id = (SELECT wallet_id FROM fx)) = l0 - 9000, 'lock released for all three';

  -- second resolution refused
  ASSERT pg_temp.err(format('SELECT public.admin_resolve_payout(%L, %L, %L, %L)', sale, 'failed', a, 'x')) = 'Payout is already completed', 'double resolve refused';

  -- record kept, review flag cleared, audited
  ASSERT (SELECT metadata->'manual_resolution'->>'outcome' FROM public.transactions WHERE id = wd) = 'failed', 'resolution recorded';
  ASSERT (SELECT metadata->'manual_resolution'->>'reason' FROM public.transactions WHERE id = wd) = 'Provider says never sent', 'reason recorded';
  ASSERT (SELECT metadata ? 'needs_review' FROM public.transactions WHERE id = wd) = false, 'needs_review cleared';
  ASSERT (SELECT count(*) FROM public.admin_audit_log WHERE action = 'resolve_payout' AND target_id IN (sale, wd, ok)) = 3, 'three audit rows';
END $$;

DO $$
DECLARE r text;
BEGIN
  FOREACH r IN ARRAY ARRAY['anon', 'authenticated'] LOOP
    EXECUTE format('SET LOCAL ROLE %I', r);
    BEGIN
      PERFORM public.admin_resolve_payout(gen_random_uuid(), 'paid', gen_random_uuid(), 'x');
      RAISE EXCEPTION 'expected refusal for %', r;
    EXCEPTION WHEN insufficient_privilege THEN NULL;
    END;
    RESET ROLE;
  END LOOP;
  ASSERT has_function_privilege('service_role', 'public.admin_resolve_payout(uuid,text,uuid,text)'::regprocedure, 'execute'), 'service_role can execute';
END $$;

-- More kinds: an NGN sale marked failed (the user keeps their NGN), and USDC sales, which also
-- move the treasury's USDC reserve (paid: reserve released and USDC sent, NGN into the treasury;
-- failed: reserve released only).
UPDATE public.wallets SET balance = balance + 9000, locked_balance = locked_balance + 9000 WHERE id = (SELECT wallet_id FROM fx);
UPDATE public.wallets SET balance = balance + 4000000, locked_balance = locked_balance + 2100000 WHERE id = public.get_treasury_wallet_id('USDC');
INSERT INTO public.transactions (wallet_id, user_id, currency, type, amount, net_amount, status, provider, idempotency_key, description, metadata)
SELECT fx.wallet_id, fx.user_id, 'NGN', 'withdrawal', -3000, -3000, 'processing', v.prov, 'test-096-' || v.k, 'test 096', v.meta
FROM fx CROSS JOIN (VALUES
  ('sale2',    'internal',   '{"kind":"bundle_sale","bundles":3}'::jsonb),
  ('usdcpaid', 'blockradar', '{"kind":"bundle_sale_usdc","bundles":3,"usdc_micro":1000000,"network_fee_micro":50000}'::jsonb),
  ('usdcfail', 'blockradar', '{"kind":"bundle_sale_usdc","bundles":3,"usdc_micro":1000000,"network_fee_micro":50000}'::jsonb)
) AS v(k, prov, meta);
CREATE TEMP TABLE w1 AS
SELECT (SELECT balance FROM public.wallets WHERE id = (SELECT wallet_id FROM fx)) AS ub,
       (SELECT locked_balance FROM public.wallets WHERE id = (SELECT wallet_id FROM fx)) AS ul,
       (SELECT balance FROM public.wallets WHERE id = public.get_treasury_wallet_id('USDC')) AS tub,
       (SELECT locked_balance FROM public.wallets WHERE id = public.get_treasury_wallet_id('USDC')) AS tul,
       (SELECT balance FROM public.wallets WHERE id = public.get_treasury_wallet_id('NGN')) AS tnb;

DO $$
DECLARE
  a uuid := (SELECT auth_id FROM fx);
  id_of text := 'SELECT id FROM public.transactions WHERE idempotency_key = %L';
  sale2 uuid; usdcpaid uuid; usdcfail uuid; w record;
BEGIN
  EXECUTE format(id_of, 'test-096-sale2') INTO sale2;
  EXECUTE format(id_of, 'test-096-usdcpaid') INTO usdcpaid;
  EXECUTE format(id_of, 'test-096-usdcfail') INTO usdcfail;
  SELECT * INTO w FROM w1;

  ASSERT public.admin_resolve_payout(sale2, 'failed', a, 'Provider rejected')->>'status' = 'failed', 'sale failed';
  ASSERT public.admin_resolve_payout(usdcpaid, 'paid', a, 'On-chain confirmed')->>'status' = 'completed', 'usdc sale paid';
  ASSERT public.admin_resolve_payout(usdcfail, 'failed', a, 'Never broadcast')->>'status' = 'failed', 'usdc sale failed';

  -- user NGN wallet: only the paid USDC sale leaves; all three holds are released
  ASSERT (SELECT balance FROM public.wallets WHERE id = (SELECT wallet_id FROM fx)) = w.ub - 3000, 'user balance';
  ASSERT (SELECT locked_balance FROM public.wallets WHERE id = (SELECT wallet_id FROM fx)) = w.ul - 9000, 'user holds released';
  -- treasury USDC: both reserves released (2 × 1,050,000); only the paid one is sent
  ASSERT (SELECT locked_balance FROM public.wallets WHERE id = public.get_treasury_wallet_id('USDC')) = w.tul - 2100000, 'treasury USDC reserves released';
  ASSERT (SELECT balance FROM public.wallets WHERE id = public.get_treasury_wallet_id('USDC')) = w.tub - 1050000, 'treasury USDC sent once';
  -- treasury NGN receives the paid sale's NGN
  ASSERT (SELECT balance FROM public.wallets WHERE id = public.get_treasury_wallet_id('NGN')) = w.tnb + 3000, 'treasury NGN in';
END $$;

SELECT 'admin_resolve_payout tests passed' AS result;
