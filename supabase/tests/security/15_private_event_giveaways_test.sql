-- 118: in a private event, the people who joined are told a giveaway is running (not only the host).
-- Run as: BEGIN; migration 118; tests/ads/_setup.sql; this file; ROLLBACK.

CREATE FUNCTION pg_temp.seen_by(p_user uuid, p_event uuid) RETURNS bigint LANGUAGE plpgsql AS $$
DECLARE n bigint;
BEGIN
  IF p_user IS NULL THEN
    PERFORM set_config('request.jwt.claims', '', true);
    SET LOCAL ROLE anon;
  ELSE
    PERFORM pg_temp.auth_as(p_user);
    SET LOCAL ROLE authenticated;
  END IF;
  SELECT count(*) INTO n FROM public.get_event_screen_giveaways(p_event);
  RESET ROLE;
  RETURN n;
END $$;

DO $$
DECLARE
  host uuid := pg_temp.mk_user('s118-host@test.local', 0);
  guest uuid := pg_temp.mk_user('s118-guest@test.local', 0);
  stranger uuid := pg_temp.mk_user('s118-stranger@test.local', 0);
  priv uuid; pub uuid;
BEGIN
  INSERT INTO public.events (host_id, title, type, event_code, status, is_private)
    VALUES (host, 'Sec 118 private', 'party', 'S118PV', 'live', true) RETURNING id INTO priv;
  INSERT INTO public.events (host_id, title, type, event_code, status, is_private)
    VALUES (host, 'Sec 118 public', 'party', 'S118PB', 'live', false) RETURNING id INTO pub;
  INSERT INTO public.event_participants (event_id, user_id, role) VALUES (priv, guest, 'guest');
  INSERT INTO public.giveaways (creator_id, title, total_amount, per_person_amount, remaining_amount, code, status, type, event_id, is_private)
    VALUES (host, 'Sec 118', 50000, 10000, 50000, 'S118G1', 'active', 'live', priv, false),
           (host, 'Sec 118', 50000, 10000, 50000, 'S118G2', 'active', 'live', pub, false),
           (host, 'Sec 118 hidden', 50000, 10000, 50000, 'S118G3', 'active', 'live', priv, true);

  -- private event
  ASSERT pg_temp.seen_by(host, priv) = 1, 'the host sees the giveaway (as before)';
  ASSERT pg_temp.seen_by(guest, priv) = 1, 'someone who joined the private event is told a giveaway is running';
  ASSERT pg_temp.seen_by(stranger, priv) = 0, 'someone who has not joined learns nothing';
  ASSERT pg_temp.seen_by(NULL, priv) = 0, 'signed out learns nothing';

  -- a private giveaway stays off the screen for everyone, joined or not
  ASSERT NOT EXISTS (SELECT 1 FROM public.giveaways g WHERE g.code = 'S118G3' AND g.is_private = false), 'setup: G3 is private';

  -- public event: unchanged
  ASSERT pg_temp.seen_by(stranger, pub) = 1, 'a public event still shows its giveaway to anyone signed in';
  ASSERT pg_temp.seen_by(NULL, pub) = 1, 'and to the signed-out big screen';

  -- leaving the event takes it away again
  DELETE FROM public.event_participants WHERE event_id = priv AND user_id = guest;
  ASSERT pg_temp.seen_by(guest, priv) = 0, 'no longer in the event, no longer told';
END $$;
SELECT 'PASS 15_private_event_giveaways' AS result;
