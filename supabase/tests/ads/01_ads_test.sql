CREATE TEMP TABLE t (k text PRIMARY KEY, v uuid);
DO $$
BEGIN
  INSERT INTO t VALUES
    ('guest', pg_temp.mk_user('ads-guest@test.local', 0)),
    ('mod', pg_temp.mk_admin('ads-mod@test.local', 'moderation')),
    ('fin', pg_temp.mk_admin('ads-fin@test.local', 'finance')),
    ('sup', pg_temp.mk_admin('ads-sup@test.local', 'support')),
    ('comp', pg_temp.mk_admin('ads-comp@test.local', 'compliance'));
END $$;

-- non-managers are refused every admin RPC
DO $$
DECLARE rk text;
BEGIN
  FOREACH rk IN ARRAY ARRAY['guest','fin','sup','comp'] LOOP
    PERFORM pg_temp.auth_as((SELECT v FROM t WHERE t.k = rk));
    BEGIN PERFORM public.admin_list_ads(); RAISE EXCEPTION 'expected refusal (%)', rk;
    EXCEPTION WHEN others THEN ASSERT SQLERRM LIKE '%Not authorized%', SQLERRM; END;
    BEGIN PERFORM public.admin_upsert_ad(NULL, 'x', '00000000-0000-4000-8000-000000000001.jpg', NULL, NULL, 0, now(), NULL);
      RAISE EXCEPTION 'expected refusal (%)', rk;
    EXCEPTION WHEN others THEN ASSERT SQLERRM LIKE '%Not authorized%', SQLERRM; END;
  END LOOP;
END $$;

-- moderation creates ads; links and paths are validated; writes are audited
SELECT pg_temp.auth_as((SELECT v FROM t WHERE k = 'mod'));
DO $$
DECLARE a public.ads; bad text;
BEGIN
  a := public.admin_upsert_ad(NULL, 'Live high', '00000000-0000-4000-8000-000000000001.jpg', NULL, '/event/abc', 5, now() - interval '1 hour', NULL);
  INSERT INTO t VALUES ('live_high', a.id);
  a := public.admin_upsert_ad(NULL, 'Live low', '00000000-0000-4000-8000-000000000002.png', '00000000-0000-4000-8000-000000000003.webp', 'https://example.com/x', 1, now() - interval '1 hour', now() + interval '1 day');
  INSERT INTO t VALUES ('live_low', a.id);
  a := public.admin_upsert_ad(NULL, 'Scheduled', '00000000-0000-4000-8000-000000000004.jpg', NULL, NULL, 9, now() + interval '1 day', NULL);
  INSERT INTO t VALUES ('scheduled', a.id);
  a := public.admin_upsert_ad(NULL, 'Ended', '00000000-0000-4000-8000-000000000005.jpg', NULL, NULL, 9, now() - interval '2 day', now() - interval '1 day');
  INSERT INTO t VALUES ('ended', a.id);
  a := public.admin_upsert_ad(NULL, 'Paused', '00000000-0000-4000-8000-000000000006.jpg', NULL, NULL, 9, now() - interval '1 hour', NULL);
  INSERT INTO t VALUES ('paused', a.id);
  PERFORM public.admin_set_ad_active(a.id, false);
  FOREACH bad IN ARRAY ARRAY['http://example.com','javascript:alert(1)','//evil.com','/\evil.com','https://a b'] LOOP
    BEGIN PERFORM public.admin_upsert_ad(NULL, 'Bad', '00000000-0000-4000-8000-000000000007.jpg', NULL, bad, 0, now(), NULL);
      RAISE EXCEPTION 'expected link rejection: %', bad;
    EXCEPTION WHEN check_violation THEN NULL; END;
  END LOOP;
  BEGIN PERFORM public.admin_upsert_ad(NULL, 'Bad path', '../x.jpg', NULL, NULL, 0, now(), NULL);
    RAISE EXCEPTION 'expected path rejection';
  EXCEPTION WHEN check_violation THEN NULL; END;
  ASSERT (SELECT count(*) FROM public.admin_audit_log WHERE target_type = 'ad' AND action = 'ad_created'
            AND admin_user_id = auth.uid()) = 5, 'creates audited';
  ASSERT EXISTS (SELECT 1 FROM public.admin_audit_log WHERE action = 'ad_paused' AND target_id = a.id), 'pause audited';
END $$;

-- guests see only live ads, highest priority first, no admin fields
SELECT pg_temp.auth_as((SELECT v FROM t WHERE k = 'guest'));
DO $$
DECLARE r jsonb := public.get_ads('home_banner');
BEGIN
  ASSERT jsonb_array_length(r) = 2, 'only the two live ads: ' || r::text;
  ASSERT (r->0->>'id')::uuid = (SELECT v FROM t WHERE k = 'live_high'), 'priority order';
  ASSERT r->1->>'image_desktop_path' = '00000000-0000-4000-8000-000000000003.webp', 'desktop path returned';
  ASSERT NOT (r->0 ? 'views'), 'no counts exposed';
  ASSERT jsonb_array_length(public.get_ads('other')) = 0, 'other placements empty';
END $$;

-- views and taps count once per user, per ad, per kind, per day
DO $$
DECLARE ad uuid := (SELECT v FROM t WHERE k = 'live_high');
BEGIN
  PERFORM public.record_ad_event(ad, 'view');
  PERFORM public.record_ad_event(ad, 'view');
  PERFORM public.record_ad_event(ad, 'tap');
  PERFORM public.record_ad_event(ad, 'tap');
  PERFORM public.record_ad_event(gen_random_uuid(), 'view'); -- unknown ad: no-op
  ASSERT (SELECT views FROM public.ads WHERE id = ad) = 1, 'view deduped';
  ASSERT (SELECT taps FROM public.ads WHERE id = ad) = 1, 'tap deduped';
  BEGIN PERFORM public.record_ad_event(ad, 'click'); RAISE EXCEPTION 'expected kind rejection';
  EXCEPTION WHEN others THEN ASSERT SQLERRM LIKE '%Invalid kind%', SQLERRM; END;
END $$;

-- delete returns the image paths and is audited
SELECT pg_temp.auth_as((SELECT v FROM t WHERE k = 'mod'));
DO $$
DECLARE paths text[] := public.admin_delete_ad((SELECT v FROM t WHERE k = 'live_low'));
BEGIN
  ASSERT paths = ARRAY['00000000-0000-4000-8000-000000000002.png','00000000-0000-4000-8000-000000000003.webp'], paths::text;
  ASSERT NOT EXISTS (SELECT 1 FROM public.ads WHERE id = (SELECT v FROM t WHERE k = 'live_low')), 'deleted';
  ASSERT EXISTS (SELECT 1 FROM public.admin_audit_log WHERE action = 'ad_deleted'), 'delete audited';
  ASSERT (SELECT count(*) FROM public.admin_list_ads()) >= 4, 'list sees all';
END $$;

-- bucket limits and write policy
DO $$
BEGIN
  ASSERT (SELECT public AND file_size_limit = 1048576 AND allowed_mime_types = ARRAY['image/jpeg','image/png','image/webp']
            FROM storage.buckets WHERE id = 'ads'), 'bucket config';
  ASSERT (SELECT count(*) FROM pg_policies WHERE schemaname = 'storage' AND tablename = 'objects' AND policyname LIKE 'ads_admin_%') = 3, 'write policies';
END $$;

SELECT 'ads tests passed' AS result;
