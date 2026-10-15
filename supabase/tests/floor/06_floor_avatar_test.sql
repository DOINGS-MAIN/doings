CREATE TEMP TABLE t (k text PRIMARY KEY, v uuid);
DO $$
DECLARE host uuid; a uuid; b uuid; c uuid; ev uuid;
BEGIN
  host := pg_temp.mk_user('fa-host@test.local', 0);
  a := pg_temp.mk_user('fa-a@test.local', 10000000);
  b := pg_temp.mk_user('fa-b@test.local', 10000000);
  c := pg_temp.mk_user('fa-c@test.local', 10000000);
  ev := pg_temp.mk_event(host);
  -- a: a real floor avatar version and moves, written the way the function writes them
  PERFORM public.merge_avatar_data((SELECT auth_id FROM public.users WHERE id = a), '{"floorVersion": 1792090000000, "danceMoves": ["samba","hip-hop"]}');
  -- b: hostile values written straight to the row (users can update their own avatar_data)
  UPDATE public.users SET avatar_data = '{"floorVersion": "../x", "danceMoves": "samba",
     "model3d": {"floorUrl": "https://evil.example/storage/v1/object/public/avatars/x/avatar-floor.glb"}}'::jsonb WHERE id = b;
  -- c: a floorUrl on a foreign host with the right path, and too many moves
  UPDATE public.users SET avatar_data = jsonb_build_object(
    'model3d', jsonb_build_object('floorUrl', 'https://evil.example/storage/v1/object/public/avatars/' || (SELECT auth_id FROM public.users WHERE id = c) || '/avatar-floor.glb'),
    'danceMoves', '["a","b","c","d"]'::jsonb) WHERE id = c;
  PERFORM public.queue_floor_spray(ev, a, 20000, 200, 1);
  PERFORM public.queue_floor_spray(ev, b, 20000, 200, 1);
  PERFORM public.queue_floor_spray(ev, c, 20000, 200, 1);
  INSERT INTO t VALUES ('ev', ev), ('a', a);
END $$;

DO $$
DECLARE j jsonb := public.get_event_floor((SELECT v FROM t WHERE k = 'ev')); fa jsonb; fb jsonb; fc jsonb; a_auth uuid;
BEGIN
  SELECT auth_id INTO a_auth FROM public.users WHERE id = (SELECT v FROM t WHERE k = 'a');
  SELECT x INTO fa FROM jsonb_array_elements(j->'floor') x WHERE x->>'slot' = '1';
  SELECT x INTO fb FROM jsonb_array_elements(j->'floor') x WHERE x->>'slot' = '2';
  SELECT x INTO fc FROM jsonb_array_elements(j->'floor') x WHERE x->>'slot' = '3';
  ASSERT fa->>'model_path' = a_auth::text || '.glb?v=1792090000000', format('own model path, got %s', fa->>'model_path');
  ASSERT fa->'moves' = '["samba","hip-hop"]'::jsonb, 'own moves';
  ASSERT fb->'model_path' = 'null'::jsonb AND fb->'moves' = '[]'::jsonb, 'hostile values give nothing (non-array moves do not raise)';
  ASSERT fc->'model_path' = 'null'::jsonb, 'a foreign-host floorUrl is never used (Review Focus 3)';
  ASSERT fc->'moves' = '[]'::jsonb, 'more than 3 moves dropped';
  ASSERT NOT (fa ? 'model_url'), 'no URL is ever returned, only a path the app pins to its own storage';
END $$;

-- merge_avatar_data is atomic and keeps other keys
DO $$
DECLARE a_auth uuid := (SELECT auth_id FROM public.users WHERE id = (SELECT v FROM t WHERE k = 'a'));
BEGIN
  PERFORM public.merge_avatar_data(a_auth, '{"danceMoves": ["silly"]}');
  ASSERT (SELECT avatar_data FROM public.users WHERE auth_id = a_auth) @> '{"floorVersion": 1792090000000, "danceMoves": ["silly"]}', 'merged';
  ASSERT EXISTS (SELECT 1 FROM storage.buckets WHERE id = 'avatar-floor' AND public AND file_size_limit = 2621440), 'server-only floor bucket';
  ASSERT NOT EXISTS (SELECT 1 FROM pg_policies WHERE schemaname = 'storage' AND tablename = 'objects' AND qual ILIKE '%avatar-floor%'), 'no client write policies on it';
END $$;

SELECT 'floor avatar tests passed' AS result;
