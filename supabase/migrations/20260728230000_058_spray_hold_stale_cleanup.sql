-- Release spray holds whose client session should have ended (crash, hang, refresh).
-- Also hide stale holds from the live projector feed.

CREATE OR REPLACE FUNCTION public.spray_hold_session_deadline(p_hold public.spray_holds)
RETURNS TIMESTAMPTZ
LANGUAGE sql
IMMUTABLE
AS $$
  SELECT p_hold.created_at + make_interval(secs =>
    GREATEST(COALESCE(NULLIF(p_hold.metadata->>'session_duration_sec', '')::int, 0), 60) + 90
  );
$$;

CREATE OR REPLACE FUNCTION public.release_stale_spray_holds()
RETURNS INT
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_hold RECORD;
  v_count INT := 0;
BEGIN
  FOR v_hold IN
    SELECT id, wallet_id, planned_amount_kobo
    FROM public.spray_holds sh
    WHERE sh.status = 'pending'
      AND public.spray_hold_session_deadline(sh) <= now()
    FOR UPDATE SKIP LOCKED
  LOOP
    UPDATE public.wallets
    SET locked_balance = GREATEST(0, locked_balance - v_hold.planned_amount_kobo),
        updated_at = now()
    WHERE id = v_hold.wallet_id;

    UPDATE public.spray_holds
    SET status = 'expired',
        settlement_type = 'cancelled',
        charged_amount_kobo = 0,
        settled_at = now()
    WHERE id = v_hold.id;

    v_count := v_count + 1;
  END LOOP;

  RETURN v_count;
END;
$$;

CREATE OR REPLACE FUNCTION public.cleanup_spray_holds()
RETURNS TABLE (expired INT, stale INT)
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_expired INT;
  v_stale INT;
BEGIN
  v_expired := public.release_expired_spray_holds();
  v_stale := public.release_stale_spray_holds();
  RETURN QUERY SELECT v_expired, v_stale;
END;
$$;

GRANT EXECUTE ON FUNCTION public.release_stale_spray_holds() TO service_role;
GRANT EXECUTE ON FUNCTION public.cleanup_spray_holds() TO service_role;
GRANT EXECUTE ON FUNCTION public.cleanup_spray_holds() TO authenticated;

-- Projector: only show holds still inside the guest spray window.
CREATE OR REPLACE FUNCTION public.get_event_live_spray_holds(p_event_id UUID)
RETURNS TABLE (
  hold_id UUID,
  planned_amount BIGINT,
  denomination INT,
  created_at TIMESTAMPTZ,
  sprayer_name TEXT,
  sprayer_username TEXT,
  sprayer_avatar_url TEXT,
  sprayer_avatar_data JSONB
)
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path = public
AS $$
  SELECT
    sh.id AS hold_id,
    sh.planned_amount_kobo AS planned_amount,
    sh.denomination,
    sh.created_at,
    COALESCE(NULLIF(trim(u.full_name), ''), NULLIF(trim(u.username), ''), 'Guest') AS sprayer_name,
    u.username AS sprayer_username,
    u.avatar_url AS sprayer_avatar_url,
    COALESCE(u.avatar_data, '{}'::jsonb) AS sprayer_avatar_data
  FROM public.spray_holds sh
  JOIN public.events e ON e.id = sh.event_id
  JOIN public.users u ON u.id = sh.sprayer_id
  WHERE sh.event_id = p_event_id
    AND sh.status = 'pending'
    AND sh.paused_at IS NULL
    AND public.spray_hold_session_deadline(sh) > now()
    AND (
      e.host_id IN (SELECT id FROM public.users WHERE auth_id = auth.uid())
      OR sh.sprayer_id IN (SELECT id FROM public.users WHERE auth_id = auth.uid())
    )
  ORDER BY sh.created_at ASC
  LIMIT 3;
$$;

-- Queue RPC: drop holds whose session window ended (still pending until cleanup runs).
CREATE OR REPLACE FUNCTION public.get_event_spray_queue_holds(p_event_id UUID)
RETURNS TABLE (
  hold_id UUID,
  planned_amount BIGINT,
  denomination INT,
  created_at TIMESTAMPTZ,
  is_paused BOOLEAN,
  sprayer_name TEXT,
  sprayer_username TEXT,
  sprayer_avatar_url TEXT,
  sprayer_avatar_data JSONB
)
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path = public
AS $$
  SELECT
    sh.id AS hold_id,
    sh.planned_amount_kobo AS planned_amount,
    sh.denomination,
    sh.created_at,
    (sh.paused_at IS NOT NULL) AS is_paused,
    COALESCE(NULLIF(trim(u.full_name), ''), NULLIF(trim(u.username), ''), 'Guest') AS sprayer_name,
    u.username AS sprayer_username,
    u.avatar_url AS sprayer_avatar_url,
    COALESCE(u.avatar_data, '{}'::jsonb) AS sprayer_avatar_data
  FROM public.spray_holds sh
  JOIN public.events e ON e.id = sh.event_id
  JOIN public.users u ON u.id = sh.sprayer_id
  WHERE sh.event_id = p_event_id
    AND sh.status = 'pending'
    AND public.spray_hold_session_deadline(sh) > now()
    AND (
      e.host_id IN (SELECT id FROM public.users WHERE auth_id = auth.uid())
      OR sh.sprayer_id IN (SELECT id FROM public.users WHERE auth_id = auth.uid())
    )
  ORDER BY sh.created_at ASC;
$$;
