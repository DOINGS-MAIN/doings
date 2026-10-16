CREATE TEMP TABLE t (k text PRIMARY KEY, v uuid, c text);
DO $$
DECLARE host uuid; ev uuid; pev uuid; gw uuid; code text; pcode text;
BEGIN
  host := pg_temp.mk_user('inv-host@test.local', 0);
  UPDATE public.users SET full_name = 'Sunny Okono', username = 'sunnyboss_inv' WHERE id = host;
  ev := pg_temp.mk_event(host);
  pev := pg_temp.mk_event(host, true);
  UPDATE public.events SET title = 'Sunnyboss Birthday', cover_url = 'https://x/c.jpg' WHERE id = ev;
  UPDATE public.events SET title = 'Secret Wedding' WHERE id = pev;
  SELECT event_code INTO code FROM public.events WHERE id = ev;
  SELECT event_code INTO pcode FROM public.events WHERE id = pev;
  INSERT INTO public.giveaways (creator_id, title, code, type, total_amount, per_person_amount, remaining_amount, status)
  VALUES (host, 'Birthday Cash Drop', 'INV777', 'scheduled', 300000, 30000, 150000, 'active') RETURNING id INTO gw;
  INSERT INTO t VALUES ('ev', ev, code), ('pev', pev, pcode);
END $$;

-- signed out (anon): public event preview, private event says only that it is private, giveaway preview
SELECT set_config('request.jwt.claims', '', true);
DO $$
DECLARE j jsonb;
BEGIN
  j := public.get_invite_preview('event', (SELECT c FROM t WHERE k = 'ev'));
  ASSERT j->>'title' = 'Sunnyboss Birthday' AND j->>'host_name' = 'Sunny Okono' AND (j->>'is_live')::boolean, format('event %s', j);
  ASSERT j->>'cover_url' = 'https://x/c.jpg' AND NOT (j ? 'id') AND NOT (j ? 'host_id'), 'no ids leaked';
  j := public.get_invite_preview('event', lower((SELECT c FROM t WHERE k = 'ev')));
  ASSERT j->>'title' = 'Sunnyboss Birthday', 'code is case-insensitive';
  j := public.get_invite_preview('event', (SELECT c FROM t WHERE k = 'pev'));
  ASSERT (j->>'is_private')::boolean AND j->'title' = 'null'::jsonb AND j->'host_name' = 'null'::jsonb, format('private %s', j);
  j := public.get_invite_preview('giveaway', 'inv777');
  ASSERT j->>'title' = 'Birthday Cash Drop' AND (j->>'per_person_amount')::bigint = 30000 AND (j->>'spots_left')::int = 5
     AND j->>'creator_name' IS NOT NULL AND j->>'status' = 'active', format('giveaway %s', j);
  ASSERT public.get_invite_preview('giveaway', 'NOPE00') IS NULL, 'unknown code';
  ASSERT public.get_invite_preview('other', 'INV777') IS NULL, 'unknown kind';
END $$;

SELECT 'invite preview tests passed' AS result;
