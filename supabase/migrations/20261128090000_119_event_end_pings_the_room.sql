-- 119: everyone in the room hears that the event has ended, at once.
-- The room re-reads on the "floor_changed" ping. Ending an event only sent that ping when a spray was
-- queued or on the floor, so a quiet room heard nothing. Guests of a public event still saw the end
-- through a database change on the event row; guests of a PRIVATE event cannot read that row, so they
-- kept seeing "Live" (and could open the Spray sheet) until the one-minute refresh (go-live test G8,
-- 2026-11-27). The end trigger now always pings the room. A second ping in the same moment is harmless.

CREATE OR REPLACE FUNCTION public._events_floor_end_settle()
RETURNS trigger LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
BEGIN
  PERFORM public.advance_event_floor(NEW.id);
  PERFORM public._floor_ping(NEW.id);
  RETURN NULL;
END;
$$;

REVOKE ALL ON FUNCTION public._events_floor_end_settle() FROM PUBLIC, anon, authenticated;
