-- Giveaway reads for the new app, and a SECURITY fix shared with the current app:
--   * "Users can view active giveaways" exposed every active giveaway (including private ones and
--     their redeem codes) to any signed-in user. Direct reads are now creator-only. The current app
--     only reads its own giveaways directly; everything else goes through the service-role edge
--     function or definer RPCs. The anon event-screen policy is untouched.
--   * get_my_giveaways(created|claimed) and get_giveaway_preview(code) for the new app.

DROP POLICY IF EXISTS "Users can view active giveaways" ON public.giveaways;
DROP POLICY IF EXISTS "Users can view own giveaways" ON public.giveaways;
CREATE POLICY "Users can view own giveaways"
  ON public.giveaways FOR SELECT TO authenticated
  USING (creator_id IN (SELECT u.id FROM public.users u WHERE u.auth_id = auth.uid()));

-- Display name used across giveaway reads: full name (unless the 'Member' placeholder), @username, 'Host'.
CREATE OR REPLACE FUNCTION public.giveaway_creator_name(p_full_name TEXT, p_username TEXT)
RETURNS TEXT
LANGUAGE sql
IMMUTABLE
SET search_path = public
AS $$
  SELECT COALESCE(
    NULLIF(NULLIF(btrim(COALESCE(p_full_name, '')), ''), 'Member'),
    CASE WHEN btrim(COALESCE(p_username, '')) <> '' THEN '@' || btrim(p_username) END,
    'Host'
  );
$$;

-- ── My giveaways: created (full detail) / claimed (what I received; no code) ──
CREATE OR REPLACE FUNCTION public.get_my_giveaways(p_scope TEXT)
RETURNS TABLE (
  id UUID,
  title TEXT,
  code TEXT,
  status public.giveaway_status,
  type public.giveaway_type,
  event_id UUID,
  event_title TEXT,
  is_private BOOLEAN,
  total_amount BIGINT,
  per_person_amount BIGINT,
  remaining_amount BIGINT,
  max_recipients INT,
  redemption_count INT,
  creator_name TEXT,
  amount_received BIGINT,
  redeemed_at TIMESTAMPTZ,
  created_at TIMESTAMPTZ,
  stopped_at TIMESTAMPTZ
)
LANGUAGE plpgsql
STABLE
SECURITY DEFINER
SET search_path = public
AS $$
#variable_conflict use_column
DECLARE
  v_caller UUID;
BEGIN
  IF p_scope IS NULL OR p_scope NOT IN ('created', 'claimed') THEN
    RAISE EXCEPTION 'Invalid scope';
  END IF;

  SELECT u.id INTO v_caller FROM public.users u WHERE u.auth_id = auth.uid();
  IF v_caller IS NULL THEN
    RETURN;
  END IF;

  IF p_scope = 'created' THEN
    RETURN QUERY
    SELECT
      g.id, g.title::TEXT, g.code::TEXT, g.status, g.type, g.event_id, ev.title::TEXT,
      COALESCE(g.is_private, false), g.total_amount, g.per_person_amount, g.remaining_amount,
      g.max_recipients,
      (SELECT count(*)::INT FROM public.giveaway_redemptions r WHERE r.giveaway_id = g.id),
      public.giveaway_creator_name(cu.full_name, cu.username),
      NULL::BIGINT, NULL::TIMESTAMPTZ, g.created_at, g.stopped_at
    FROM public.giveaways g
    JOIN public.users cu ON cu.id = g.creator_id
    LEFT JOIN public.events ev ON ev.id = g.event_id
    WHERE g.creator_id = v_caller
    ORDER BY g.created_at DESC;
  ELSE
    RETURN QUERY
    SELECT
      g.id, g.title::TEXT, NULL::TEXT, g.status, g.type, g.event_id, ev.title::TEXT,
      COALESCE(g.is_private, false), NULL::BIGINT, g.per_person_amount, NULL::BIGINT,
      NULL::INT, NULL::INT,
      public.giveaway_creator_name(cu.full_name, cu.username),
      r.amount, r.redeemed_at, g.created_at, g.stopped_at
    FROM public.giveaway_redemptions r
    JOIN public.giveaways g ON g.id = r.giveaway_id
    JOIN public.users cu ON cu.id = g.creator_id
    LEFT JOIN public.events ev ON ev.id = g.event_id
    WHERE r.user_id = v_caller
    ORDER BY r.redeemed_at DESC;
  END IF;
END;
$$;

-- ── Preview by code (claim modal): never returns code, totals or redeemers ──
CREATE OR REPLACE FUNCTION public.get_giveaway_preview(p_code TEXT)
RETURNS TABLE (
  id UUID,
  title TEXT,
  status public.giveaway_status,
  per_person_amount BIGINT,
  spots_left INT,
  creator_name TEXT,
  is_mine BOOLEAN,
  already_claimed BOOLEAN
)
LANGUAGE plpgsql
STABLE
SECURITY DEFINER
SET search_path = public
AS $$
#variable_conflict use_column
DECLARE
  v_caller UUID;
  v_code TEXT := NULLIF(upper(regexp_replace(COALESCE(p_code, ''), '[\s-]', '', 'g')), '');
BEGIN
  IF v_code IS NULL THEN
    RETURN;
  END IF;
  SELECT u.id INTO v_caller FROM public.users u WHERE u.auth_id = auth.uid();

  RETURN QUERY
  SELECT
    g.id,
    g.title::TEXT,
    g.status,
    g.per_person_amount,
    CASE WHEN g.status = 'active' THEN (g.remaining_amount / g.per_person_amount)::INT ELSE 0 END,
    public.giveaway_creator_name(cu.full_name, cu.username),
    COALESCE(g.creator_id = v_caller, false),
    EXISTS (
      SELECT 1 FROM public.giveaway_redemptions r WHERE r.giveaway_id = g.id AND r.user_id = v_caller
    )
  FROM public.giveaways g
  JOIN public.users cu ON cu.id = g.creator_id
  WHERE g.code = v_code
  LIMIT 1;
END;
$$;

REVOKE ALL ON FUNCTION public.get_my_giveaways(TEXT) FROM PUBLIC;
REVOKE ALL ON FUNCTION public.get_giveaway_preview(TEXT) FROM PUBLIC;
REVOKE ALL ON FUNCTION public.get_my_giveaways(TEXT) FROM anon;
REVOKE ALL ON FUNCTION public.get_giveaway_preview(TEXT) FROM anon;
GRANT EXECUTE ON FUNCTION public.get_my_giveaways(TEXT) TO authenticated;
GRANT EXECUTE ON FUNCTION public.get_giveaway_preview(TEXT) TO authenticated;
