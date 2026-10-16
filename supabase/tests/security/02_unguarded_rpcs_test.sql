-- 094: signed-in users can't call the unguarded SECURITY DEFINER writers (any of them could set
-- the platform FX market rate, list every wallet balance, or release other people's spray holds);
-- the server (service_role) still can.

DO $$
DECLARE r text; stmt text;
BEGIN
  FOREACH r IN ARRAY ARRAY['anon', 'authenticated'] LOOP
    EXECUTE format('SET LOCAL ROLE %I', r);
    FOREACH stmt IN ARRAY ARRAY[
      'SELECT public.update_fx_market_rate(1, ''attack'', ''{}''::jsonb)',
      'SELECT count(*) FROM public.reconcile_wallets()',
      'SELECT public.cleanup_spray_holds()',
      'SELECT public.release_expired_spray_holds()',
      'SELECT public.release_stale_spray_holds()'
    ] LOOP
      BEGIN
        EXECUTE stmt;
        RAISE EXCEPTION 'expected refusal for % : %', r, stmt;
      EXCEPTION WHEN insufficient_privilege THEN NULL;
      END;
    END LOOP;
    RESET ROLE;
  END LOOP;
END $$;

DO $$
DECLARE f text;
BEGIN
  FOREACH f IN ARRAY ARRAY['public.update_fx_market_rate(bigint,text,jsonb)', 'public.reconcile_wallets()',
    'public.cleanup_spray_holds()', 'public.release_expired_spray_holds()', 'public.release_stale_spray_holds()'] LOOP
    ASSERT has_function_privilege('service_role', f::regprocedure, 'execute'), 'service_role keeps ' || f;
  END LOOP;
END $$;

SELECT 'unguarded rpc tests passed' AS result;
