CREATE TEMP TABLE t (k text PRIMARY KEY, v uuid);
DO $$
DECLARE host uuid; a uuid; b uuid; ev uuid; a_auth uuid; b_auth uuid;
BEGIN
  host := pg_temp.mk_user('fa-host@test.local', 0);
  a := pg_temp.mk_user('fa-a@test.local', 10000000);
  b := pg_temp.mk_user('fa-b@test.local', 10000000);
  ev := pg_temp.mk_event(host);
  SELECT auth_id INTO a_auth FROM public.users WHERE id = a;
  SELECT auth_id INTO b_auth FROM public.users WHERE id = b;
  UPDATE public.users SET avatar_data = jsonb_build_object(
    'model3d', jsonb_build_object('floorUrl', 'https://x.supabase.co/storage/v1/object/public/avatars/' || a_auth || '/avatar-floor.glb?v=123'),
    'danceMoves', '["samba","hip-hop"]'::jsonb) WHERE id = a;
  -- b points at a's file and has junk moves
  UPDATE public.users SET avatar_data = jsonb_build_object(
    'model3d', jsonb_build_object('floorUrl', 'https://x.supabase.co/storage/v1/object/public/avatars/' || a_auth || '/avatar-floor.glb'),
    'danceMoves', '["Hip Hop", 3]'::jsonb) WHERE id = b;
  PERFORM public.queue_floor_spray(ev, a, 20000, 200, 1);
  PERFORM public.queue_floor_spray(ev, b, 20000, 200, 1);
  INSERT INTO t VALUES ('ev', ev), ('a', a), ('b', b);
END $$;

DO $$
DECLARE j jsonb := public.get_event_floor((SELECT v FROM t WHERE k = 'ev')); fa jsonb; fb jsonb;
BEGIN
  SELECT x INTO fa FROM jsonb_array_elements(j->'floor') x WHERE x->>'slot' = '1';
  SELECT x INTO fb FROM jsonb_array_elements(j->'floor') x WHERE x->>'slot' = '2';
  ASSERT fa->>'model_url' LIKE '%/avatars/%/avatar-floor.glb?v=123', format('own model url, got %s', fa->>'model_url');
  ASSERT fa->'moves' = '["samba","hip-hop"]'::jsonb, 'own moves';
  ASSERT fb->'model_url' = 'null'::jsonb, 'someone else''s file is refused (Review Focus 3)';
  ASSERT fb->'moves' = '[]'::jsonb, 'junk moves dropped';
  ASSERT public._floor_model_url('https://evil.example/avatars/x/avatar-floor.glb', gen_random_uuid()) IS NULL, 'foreign host';
  ASSERT public._floor_moves('["a","b","c","d"]'::jsonb) = '[]'::jsonb, 'more than 3';
END $$;

SELECT 'floor avatar tests passed' AS result;
