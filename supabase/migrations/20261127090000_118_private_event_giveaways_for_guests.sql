-- 118: guests of a private event are told a giveaway is running.
-- get_event_screen_giveaways (the yellow "Giveaway is active" bar and the QR card in the live room)
-- sent a private event's giveaways only to the host, so guests who had joined saw nothing and had no
-- way to scan and claim from the room (go-live test F1, 2026-11-26). It now also answers people who
-- have joined the event. Nothing else changes: people outside a private event still learn nothing, a
-- private giveaway is still never listed, and public events behave as before. Grants are unchanged
-- (CREATE OR REPLACE keeps them).

CREATE OR REPLACE FUNCTION public.get_event_screen_giveaways(p_event_id UUID)
RETURNS TABLE (
  id UUID,
  title TEXT,
  code TEXT,
  per_person_amount BIGINT,
  remaining_amount BIGINT,
  status public.giveaway_status,
  show_on_event_screen BOOLEAN
)
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path = public
AS $$
  SELECT
    g.id,
    g.title,
    g.code,
    g.per_person_amount,
    g.remaining_amount,
    g.status,
    g.show_on_event_screen
  FROM public.giveaways g
  JOIN public.events e ON e.id = g.event_id
  WHERE g.event_id = p_event_id
    AND g.status = 'active'
    AND g.show_on_event_screen = true
    AND COALESCE(g.is_private, false) = false
    AND e.status = 'live'
    AND (
      (e.is_private = false)
      OR e.host_id IN (SELECT u.id FROM public.users u WHERE u.auth_id = auth.uid())
      -- someone who has joined the private event
      OR EXISTS (
        SELECT 1 FROM public.event_participants p
        JOIN public.users u ON u.id = p.user_id
        WHERE p.event_id = e.id AND u.auth_id = auth.uid()
      )
    )
  ORDER BY g.created_at DESC;
$$;
