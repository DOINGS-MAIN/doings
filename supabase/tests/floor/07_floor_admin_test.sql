CREATE TEMP TABLE t (k text PRIMARY KEY, v uuid);
DO $$
DECLARE guest uuid; support uuid; finance uuid;
BEGIN
  guest := pg_temp.mk_user('adm-guest@test.local', 0);
  support := pg_temp.mk_user('adm-support@test.local', 0);
  finance := pg_temp.mk_user('adm-finance@test.local', 0);
  UPDATE public.users SET username = 'adm_guest_x', full_name = 'Ada Guestwoman' WHERE id = guest;
  PERFORM public.merge_avatar_data((SELECT auth_id FROM public.users WHERE id = guest), '{"floorVersion": 1792090000000, "danceMoves": ["samba"]}');
  INSERT INTO public.admin_roles (user_id, role) VALUES ((SELECT auth_id FROM public.users WHERE id = support), 'support');
  INSERT INTO public.admin_roles (user_id, role) VALUES ((SELECT auth_id FROM public.users WHERE id = finance), 'finance');
  INSERT INTO t VALUES ('guest', guest), ('support', support), ('finance', finance);
END $$;

-- a non-moderator (finance) and a plain guest are refused
SELECT pg_temp.auth_as((SELECT v FROM t WHERE k = 'finance'));
DO $$
BEGIN
  BEGIN PERFORM public.admin_list_floor_avatars(NULL, 50); RAISE EXCEPTION 'expected refusal';
  EXCEPTION WHEN others THEN ASSERT SQLERRM LIKE '%Not authorized%', SQLERRM; END;
  BEGIN PERFORM public.admin_clear_floor_avatar((SELECT v FROM t WHERE k = 'guest'), 'x'); RAISE EXCEPTION 'expected refusal';
  EXCEPTION WHEN others THEN ASSERT SQLERRM LIKE '%Not authorized%', SQLERRM; END;
END $$;
SELECT pg_temp.auth_as((SELECT v FROM t WHERE k = 'guest'));
DO $$
BEGIN
  BEGIN PERFORM public.admin_clear_floor_avatar((SELECT v FROM t WHERE k = 'guest'), 'x'); RAISE EXCEPTION 'expected refusal';
  EXCEPTION WHEN others THEN ASSERT SQLERRM LIKE '%Not authorized%', SQLERRM; END;
END $$;

-- support lists (with search) and removes; the audit log records it; moves are kept
SELECT pg_temp.auth_as((SELECT v FROM t WHERE k = 'support'));
DO $$
DECLARE n int;
BEGIN
  SELECT count(*) INTO n FROM public.admin_list_floor_avatars('adm_guest', 50) WHERE user_id = (SELECT v FROM t WHERE k = 'guest');
  ASSERT n = 1, 'listed by username search';
  SELECT count(*) INTO n FROM public.admin_list_floor_avatars('guestwoman', 50) WHERE user_id = (SELECT v FROM t WHERE k = 'guest');
  ASSERT n = 1, 'listed by name search';
  PERFORM public.admin_clear_floor_avatar((SELECT v FROM t WHERE k = 'guest'), 'offensive outfit');
  ASSERT NOT ((SELECT avatar_data FROM public.users WHERE id = (SELECT v FROM t WHERE k = 'guest')) ? 'floorVersion'), 'floor avatar removed';
  ASSERT (SELECT avatar_data->'danceMoves' FROM public.users WHERE id = (SELECT v FROM t WHERE k = 'guest')) = '["samba"]', 'moves kept';
  ASSERT EXISTS (SELECT 1 FROM public.admin_audit_log WHERE action = 'floor_avatar_removed'
                   AND target_id = (SELECT v FROM t WHERE k = 'guest') AND details->>'reason' = 'offensive outfit'), 'audited';
  SELECT count(*) INTO n FROM public.admin_list_floor_avatars('adm_guest', 50);
  ASSERT n = 0, 'no longer listed';
END $$;

SELECT 'floor admin tests passed' AS result;
