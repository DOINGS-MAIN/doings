-- 098: an admin stop returns exactly the remainder to the creator, records who and why, notifies the
-- creator (refund line only when something was refunded), and audits; service_role only.

CREATE FUNCTION pg_temp.err(q text) RETURNS text LANGUAGE plpgsql AS $$
BEGIN EXECUTE q; RETURN NULL; EXCEPTION WHEN OTHERS THEN RETURN SQLERRM; END $$;

-- The admin is a different account (the second internal stand-in), so the test can tell "credited the
-- creator" from "credited the admin".
CREATE TEMP TABLE fx AS
SELECT u.id AS user_id, u.auth_id, (SELECT id FROM public.wallets WHERE user_id = u.id AND currency = 'NGN') AS wallet_id,
       adm.auth_id AS admin_auth_id,
       (SELECT id FROM public.wallets WHERE user_id = adm.id AND currency = 'NGN') AS admin_wallet_id
FROM public.users u, public.users adm
WHERE u.id = '53f63182-22be-4f1f-aa78-c24d52ad4f3d' AND adm.id = '17df71bf-bd30-4632-aafd-f111d792762b';
-- credit_wallet refuses KYC level 0 ("Verify your email to receive funds"); creators are at least Level 1.
UPDATE public.users SET kyc_level = 1 WHERE id = (SELECT user_id FROM fx);

INSERT INTO public.giveaways (creator_id, title, total_amount, per_person_amount, remaining_amount, code, status, type)
SELECT user_id, v.t, 50000, 10000, v.rem, v.code, v.st::public.giveaway_status, 'live'
FROM fx CROSS JOIN (VALUES
  ('Party fund', 30000, 'T098AAA', 'active'),
  ('Empty one',  0,     'T098BBB', 'active'),
  ('Done one',   0,     'T098CCC', 'exhausted')
) AS v(t, rem, code, st);

CREATE TEMP TABLE b0 AS SELECT balance,
  (SELECT balance FROM public.wallets WHERE id = (SELECT admin_wallet_id FROM fx)) AS admin_balance
FROM public.wallets WHERE id = (SELECT wallet_id FROM fx);

DO $$
DECLARE
  a uuid := (SELECT admin_auth_id FROM fx);
  u uuid := (SELECT user_id FROM fx);
  g_live uuid := (SELECT id FROM public.giveaways WHERE code = 'T098AAA');
  g_empty uuid := (SELECT id FROM public.giveaways WHERE code = 'T098BBB');
  g_done uuid := (SELECT id FROM public.giveaways WHERE code = 'T098CCC');
  q text := 'SELECT public.admin_stop_giveaway(%L, %L, %L)';
  r jsonb;
BEGIN
  ASSERT pg_temp.err(format(q, gen_random_uuid(), a, 'x')) = 'Giveaway not found', 'missing';
  ASSERT pg_temp.err(format(q, g_done, a, 'x')) = 'Giveaway is not active', 'exhausted refused';
  ASSERT pg_temp.err(format(q, g_live, a, '  ')) = 'A reason is required', 'blank reason';

  ASSERT a <> (SELECT auth_id FROM fx), 'fixture: admin and creator differ';
  ASSERT pg_temp.err(format(q, g_live, a, repeat('x', 501))) = 'Keep the reason under 500 characters', 'reason capped';
  r := public.admin_stop_giveaway(g_live, a, 'Misleading title.');
  ASSERT (r->>'refunded')::bigint = 30000, 'refunded the remainder';
  ASSERT (SELECT balance FROM public.wallets WHERE id = (SELECT wallet_id FROM fx)) = (SELECT balance FROM b0) + 30000, 'creator credited exactly';
  ASSERT (SELECT status FROM public.giveaways WHERE id = g_live) = 'stopped', 'stopped';
  ASSERT (SELECT remaining_amount FROM public.giveaways WHERE id = g_live) = 0, 'nothing left';
  ASSERT (SELECT refund_transaction_id IS NOT NULL FROM public.giveaways WHERE id = g_live), 'refund txn recorded';
  ASSERT (SELECT stopped_by FROM public.giveaways WHERE id = g_live) = a, 'who';
  ASSERT (SELECT stop_reason FROM public.giveaways WHERE id = g_live) = 'Misleading title.', 'why';
  ASSERT (SELECT balance FROM public.wallets WHERE id = (SELECT admin_wallet_id FROM fx)) = (SELECT admin_balance FROM b0), 'admin wallet untouched';
  ASSERT EXISTS (SELECT 1 FROM public.notifications WHERE user_id = u AND type = 'giveaway_stopped'
                 AND (data->>'refunded')::bigint = 30000 AND data->>'giveaway_id' = g_live::text), 'notification data carries the refund';
  ASSERT NOT EXISTS (SELECT 1 FROM public.notifications WHERE user_id = u AND body LIKE '%title..%'), 'no double full stop';
  ASSERT EXISTS (SELECT 1 FROM public.notifications WHERE user_id = u AND type = 'giveaway_stopped'
                 AND body LIKE '%"Party fund" was stopped by Doings: Misleading title.%'
                 AND body LIKE '%₦300.00 was returned to your Bag.%'), 'creator told, with the refund';
  ASSERT pg_temp.err(format(q, g_live, a, 'again')) = 'Giveaway is not active', 'second stop refused';
  ASSERT (SELECT count(*) FROM public.admin_audit_log WHERE action = 'stop_giveaway' AND target_id = g_live
          AND admin_user_id = a AND details->>'reason' = 'Misleading title.' AND (details->>'refunded')::bigint = 30000
          AND details->>'creator_id' = u::text) = 1, 'audited with admin, reason, refund and creator';

  r := public.admin_stop_giveaway(g_empty, a, 'Duplicate');
  ASSERT (r->>'refunded')::bigint = 0, 'nothing to refund';
  ASSERT (SELECT balance FROM public.wallets WHERE id = (SELECT wallet_id FROM fx)) = (SELECT balance FROM b0) + 30000, 'no further credit';
  ASSERT (SELECT status FROM public.giveaways WHERE id = g_empty) = 'stopped', 'empty one stopped';
  ASSERT EXISTS (SELECT 1 FROM public.notifications WHERE user_id = u AND type = 'giveaway_stopped'
                 AND body LIKE '%"Empty one" was stopped by Doings: Duplicate.' ), 'no refund line when nothing was refunded';
END $$;

DO $$
DECLARE r text;
BEGIN
  FOREACH r IN ARRAY ARRAY['anon', 'authenticated'] LOOP
    ASSERT NOT has_function_privilege(r, 'public.admin_stop_giveaway(uuid,uuid,text)'::regprocedure, 'execute'), r || ' must not execute';
  END LOOP;
  ASSERT has_function_privilege('service_role', 'public.admin_stop_giveaway(uuid,uuid,text)'::regprocedure, 'execute'), 'service_role';
END $$;

SELECT 'stop giveaway tests passed' AS result;
