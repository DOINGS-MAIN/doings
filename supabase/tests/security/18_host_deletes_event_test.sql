-- 121: an event the host deleted leaves every list and link; the guests who were in it still see it.
-- Run as: BEGIN; migration 121; tests/ads/_setup.sql; this file; ROLLBACK.

CREATE FUNCTION pg_temp.as_user(p_user uuid) RETURNS void LANGUAGE plpgsql AS $$
BEGIN
  PERFORM pg_temp.auth_as(p_user);
END $$;

DO $$
DECLARE
  host uuid := pg_temp.mk_user('s121-host@test.local', 0);
  guest uuid := pg_temp.mk_user('s121-guest@test.local', 0);
  stranger uuid := pg_temp.mk_user('s121-stranger@test.local', 0);
  gone uuid; kept uuid; n bigint;
BEGIN
  INSERT INTO public.events (host_id, title, type, event_code, status, is_private, event_date)
    VALUES (host, 'Sec 121 gone', 'party', 'S121GN', 'live', false, CURRENT_DATE) RETURNING id INTO gone;
  INSERT INTO public.events (host_id, title, type, event_code, status, is_private, event_date)
    VALUES (host, 'Sec 121 kept', 'party', 'S121KP', 'live', false, CURRENT_DATE) RETURNING id INTO kept;
  INSERT INTO public.event_participants (event_id, user_id, role) VALUES (gone, guest, 'guest'), (kept, guest, 'guest');

  -- before: everything shows
  PERFORM pg_temp.as_user(host);
  SELECT count(*) INTO n FROM public.get_events_feed('hosted') WHERE id IN (gone, kept);
  ASSERT n = 2, 'before: the host lists both events';
  SELECT count(*) INTO n FROM public.get_my_live_events_for_giveaway() WHERE id IN (gone, kept);
  ASSERT n = 2, 'before: both can take a giveaway';

  UPDATE public.events SET status = 'ended', ended_at = now(), deleted_at = now() WHERE id = gone;

  PERFORM pg_temp.as_user(host);
  SELECT count(*) INTO n FROM public.get_events_feed('hosted') WHERE id = gone;
  ASSERT n = 0, 'the host no longer lists the deleted event';
  SELECT count(*) INTO n FROM public.get_events_feed('hosted') WHERE id = kept;
  ASSERT n = 1, 'the other event is untouched';
  SELECT count(*) INTO n FROM public.get_event_view(gone, NULL);
  ASSERT n = 0, 'the host cannot open the deleted event';
  SELECT count(*) INTO n FROM public.get_my_live_events_for_giveaway() WHERE id = gone;
  ASSERT n = 0, 'it cannot take a giveaway';

  PERFORM pg_temp.as_user(guest);
  SELECT count(*) INTO n FROM public.get_events_feed('joined') WHERE id = gone;
  ASSERT n = 0, 'it leaves the guest''s list';
  SELECT count(*) INTO n FROM public.get_event_view(gone, NULL) WHERE status = 'ended';
  ASSERT n = 1, 'a guest who was in it still sees it, as ended';

  PERFORM pg_temp.as_user(stranger);
  SELECT count(*) INTO n FROM public.get_events_feed('discover') WHERE id = gone;
  ASSERT n = 0, 'it is not in Discover';
  SELECT count(*) INTO n FROM public.get_event_view(gone, NULL);
  ASSERT n = 0, 'someone who was never in it cannot open it';
  SELECT count(*) INTO n FROM public.get_event_view(NULL, 'S121GN');
  ASSERT n = 0, 'nor find it by its code';
  ASSERT public.get_invite_preview('event', 'S121GN') IS NULL, 'its join link shows nothing';
  ASSERT public.get_invite_preview('event', 'S121KP') IS NOT NULL, 'the other event''s join link still works';
END $$;

SELECT 'PASS 18_host_deletes_event' AS result;
