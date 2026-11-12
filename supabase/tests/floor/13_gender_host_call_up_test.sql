-- 105: gender + stand-in on the floor feed; the host calls a guest up directly.
CREATE FUNCTION pg_temp.err(q text) RETURNS text LANGUAGE plpgsql AS $$
BEGIN EXECUTE q; RETURN NULL; EXCEPTION WHEN OTHERS THEN RETURN SQLERRM; END $$;

DO $$
DECLARE host uuid; g1 uuid; g2 uuid; g3 uuid; unv uuid; outsider uuid; ev uuid; st jsonb; c jsonb; n int;
BEGIN
  host := pg_temp.mk_user('h105-host@test.local', 0);
  g1 := pg_temp.mk_user('h105-g1@test.local', 100000);
  g2 := pg_temp.mk_user('h105-g2@test.local', 0);
  g3 := pg_temp.mk_user('h105-g3@test.local', 0);
  unv := pg_temp.mk_user('h105-unv@test.local', 0);
  outsider := pg_temp.mk_user('h105-out@test.local', 0);
  UPDATE public.users SET kyc_level = 0 WHERE id = unv;
  UPDATE public.users SET full_name = 'Bisi Adeyemi', username = 'bisi_105' WHERE id = g1;
  UPDATE public.users SET full_name = '100%_real', username = 'pct_105' WHERE id = g2;
  ev := pg_temp.mk_event(host);
  INSERT INTO public.event_participants (event_id, user_id) VALUES (ev, g1), (ev, g2), (ev, g3), (ev, unv);

  -- gender: only the two values; null allowed
  ASSERT pg_temp.err(format('UPDATE public.users SET gender = %L WHERE id = %L', 'other', g1)) IS NOT NULL, 'unknown gender refused';
  UPDATE public.users SET gender = 'female' WHERE id = g1;
  UPDATE public.users SET gender = NULL WHERE id = g2;

  -- a user may set their own gender through the column grant, and still nothing sensitive
  ASSERT has_column_privilege('authenticated', 'public.users', 'gender', 'UPDATE'), 'authenticated may update gender';
  ASSERT NOT has_column_privilege('authenticated', 'public.users', 'kyc_level', 'UPDATE'), 'kyc_level stays locked';

  -- candidates: host only, joined guests, never the host, flags the unverified
  PERFORM pg_temp.auth_as(g1);
  ASSERT pg_temp.err(format('SELECT public.list_call_up_candidates(%L)', ev)) = 'CALLUP_NOT_HOST', 'guest cannot list';
  ASSERT pg_temp.err(format('SELECT public.host_call_up(%L, %L)', ev, g2)) = 'CALLUP_NOT_HOST', 'guest cannot call up';
  PERFORM pg_temp.auth_as(host);
  c := public.list_call_up_candidates(ev);
  ASSERT jsonb_array_length(c) = 4, format('4 candidates, got %s', jsonb_array_length(c));
  ASSERT NOT EXISTS (SELECT 1 FROM jsonb_array_elements(c) e WHERE e->>'id' IN (host::text, outsider::text)), 'no host, no outsider';
  ASSERT (SELECT (e->>'verified')::boolean FROM jsonb_array_elements(c) e WHERE e->>'id' = unv::text) = false, 'unverified flagged';
  ASSERT jsonb_array_length(public.list_call_up_candidates(ev, 'BISI')) = 1, 'search by name, case-insensitive';
  ASSERT jsonb_array_length(public.list_call_up_candidates(ev, 'bisi_105')) = 1, 'search by username';
  ASSERT jsonb_array_length(public.list_call_up_candidates(ev, '%')) = 1, 'percent is text, not a wildcard';
  ASSERT jsonb_array_length(public.list_call_up_candidates(ev, '   ')) = 4, 'blank search lists everyone';

  -- call up directly
  st := public.host_call_up(ev, g1);
  ASSERT jsonb_array_length(st->'called_up') = 1 AND st->'called_up'->0->>'id' = g1::text, 'g1 called up';
  ASSERT (SELECT initiated_by FROM public.event_call_ups WHERE event_id = ev AND guest_id = g1) = 'host', 'row marked host';
  PERFORM public.host_call_up(ev, g1);
  ASSERT (SELECT count(*) FROM public.event_call_ups WHERE event_id = ev AND guest_id = g1) = 1, 'calling up twice is a no-op';
  ASSERT jsonb_array_length(public.list_call_up_candidates(ev)) = 3, 'called-up guest leaves the candidates';
  PERFORM pg_temp.auth_as(g1);
  ASSERT public.get_call_ups(ev)->'me'->>'status' = 'accepted', 'guest sees accepted';

  -- a waiting request is accepted, not duplicated
  PERFORM pg_temp.auth_as(g2); PERFORM public.request_call_up(ev);
  PERFORM pg_temp.auth_as(host); PERFORM public.host_call_up(ev, g2);
  ASSERT (SELECT string_agg(status || '/' || initiated_by, ',') FROM public.event_call_ups WHERE event_id = ev AND guest_id = g2) = 'accepted/guest', 'request accepted in place';

  -- refusals
  ASSERT pg_temp.err(format('SELECT public.host_call_up(%L, %L)', ev, unv)) = 'CALLUP_NOT_VERIFIED', 'unverified refused';
  ASSERT pg_temp.err(format('SELECT public.host_call_up(%L, %L)', ev, outsider)) = 'CALLUP_NOT_JOINED', 'not joined refused';
  ASSERT pg_temp.err(format('SELECT public.host_call_up(%L, %L)', ev, host)) = 'CALLUP_HOST', 'host cannot call themselves up';

  -- host call-ups never use up the guest's own requests: remove + call up 3 times, then the guest can still ask
  FOR n IN 1..4 LOOP
    PERFORM public.host_call_up(ev, g3);
    IF n < 4 THEN
      PERFORM public.remove_call_up((SELECT id FROM public.event_call_ups WHERE event_id = ev AND guest_id = g3 AND status = 'accepted'));
    END IF;
  END LOOP;
  PERFORM public.remove_call_up((SELECT id FROM public.event_call_ups WHERE event_id = ev AND guest_id = g3 AND status = 'accepted'));
  PERFORM pg_temp.auth_as(g3);
  ASSERT (public.get_call_ups(ev)->'me'->>'retry_after_seconds')::int = 0, 'no cooldown from host call-ups';
  ASSERT pg_temp.err(format('SELECT public.request_call_up(%L)', ev)) IS NULL, 'guest can still request';

  -- not live
  UPDATE public.events SET status = 'ended' WHERE id = ev;
  PERFORM pg_temp.auth_as(host);
  ASSERT pg_temp.err(format('SELECT public.host_call_up(%L, %L)', ev, g1)) = 'CALLUP_NOT_LIVE', 'ended event refused';
  UPDATE public.events SET status = 'live' WHERE id = ev;

  -- floor feed: standin follows gender, null when unset
  INSERT INTO public.spray_holds (event_id, sprayer_id, wallet_id, planned_amount_kobo, denomination, note_count, status, metadata,
                                  expires_at, queued_at, floor_seconds, floor_band_seconds, floor_slot, floor_started_at, floor_ends_at)
  VALUES (ev, g1, (SELECT id FROM public.wallets WHERE user_id = g1 AND currency = 'NGN'), 100000, 200, 5, 'on_floor', '{"floor": true}',
          now() + interval '1 hour', now(), 120, 120, 1, now(), now() + interval '120 seconds'),
         (ev, g2, (SELECT id FROM public.wallets WHERE user_id = g2 AND currency = 'NGN'), 100000, 200, 5, 'on_floor', '{"floor": true}',
          now() + interval '1 hour', now(), 120, 120, 2, now(), now() + interval '120 seconds');
  st := public.get_event_floor(ev);
  ASSERT (SELECT e->>'standin' FROM jsonb_array_elements(st->'floor') e WHERE (e->>'slot')::int = 1) = 'f', 'female → f';
  ASSERT (SELECT e->'standin' FROM jsonb_array_elements(st->'floor') e WHERE (e->>'slot')::int = 2) = 'null'::jsonb, 'unset → null';
  ASSERT NOT (st->'floor'->0 ? 'gender'), 'the feed never carries gender itself';
END $$;

-- privileges
DO $$
BEGIN
  ASSERT NOT has_function_privilege('anon', 'public.list_call_up_candidates(uuid, text)', 'EXECUTE'), 'anon cannot list candidates';
  ASSERT NOT has_function_privilege('anon', 'public.host_call_up(uuid, uuid)', 'EXECUTE'), 'anon cannot call up';
  ASSERT has_function_privilege('authenticated', 'public.host_call_up(uuid, uuid)', 'EXECUTE'), 'authenticated can call host_call_up';
  ASSERT has_function_privilege('anon', 'public.get_event_floor(uuid)', 'EXECUTE'), 'projector still reads the floor';
END $$;
