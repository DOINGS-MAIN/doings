-- 119: ending an event pings the room even when nobody is spraying.
-- Run as: BEGIN; migration 119; tests/ads/_setup.sql; this file; ROLLBACK.

DO $$
DECLARE
  host uuid := pg_temp.mk_user('s119-host@test.local', 0);
  quiet uuid; draft uuid;
  n bigint;
BEGIN
  INSERT INTO public.events (host_id, title, type, event_code, status, is_private)
    VALUES (host, 'Sec 119 quiet', 'party', 'S119QT', 'live', true) RETURNING id INTO quiet;
  INSERT INTO public.events (host_id, title, type, event_code, status, is_private)
    VALUES (host, 'Sec 119 draft', 'party', 'S119DR', 'draft', false) RETURNING id INTO draft;

  UPDATE public.events SET status = 'ended' WHERE id = quiet;
  SELECT count(*) INTO n FROM realtime.messages WHERE topic = 'floor:' || quiet::text AND event = 'floor_changed';
  ASSERT n >= 1, 'ending a live event with an empty floor pings the room';

  UPDATE public.events SET status = 'live' WHERE id = draft;
  SELECT count(*) INTO n FROM realtime.messages WHERE topic = 'floor:' || draft::text AND event = 'floor_changed';
  ASSERT n = 0, 'going live is not an end and sends no end ping';
END $$;

SELECT 'PASS 16_event_end_pings_the_room' AS result;
