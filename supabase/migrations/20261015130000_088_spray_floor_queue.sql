-- Dance floor queue (part 1). Spec: DOINGSNEWFACE docs/superpowers/specs/2026-10-15-dance-floor-queue-design.md
-- Floor sprays are spray_holds rows: queued -> on_floor -> settled | released. Old-app rows
-- (pending/expired/pause) are untouched; settle_spray_hold and create_spray_hold are unchanged.

-- ── A. Schema, settings, pure maths ────────────────────────────────────────────────────────

ALTER TABLE public.spray_holds
  ADD COLUMN IF NOT EXISTS queued_at TIMESTAMPTZ,
  ADD COLUMN IF NOT EXISTS floor_band_seconds INT,
  ADD COLUMN IF NOT EXISTS floor_seconds INT,
  ADD COLUMN IF NOT EXISTS floor_slot SMALLINT CHECK (floor_slot BETWEEN 1 AND 8),
  ADD COLUMN IF NOT EXISTS floor_started_at TIMESTAMPTZ,
  ADD COLUMN IF NOT EXISTS floor_ends_at TIMESTAMPTZ,
  ADD COLUMN IF NOT EXISTS release_reason TEXT CHECK (release_reason IN ('left', 'max_wait', 'event_ended'));

CREATE UNIQUE INDEX IF NOT EXISTS uq_spray_holds_floor_slot
  ON public.spray_holds (event_id, floor_slot) WHERE status = 'on_floor';
CREATE UNIQUE INDEX IF NOT EXISTS uq_spray_holds_floor_person
  ON public.spray_holds (event_id, sprayer_id) WHERE status IN ('queued', 'on_floor');
CREATE INDEX IF NOT EXISTS idx_spray_holds_floor_queue
  ON public.spray_holds (event_id, status, queued_at) WHERE status IN ('queued', 'on_floor');

CREATE OR REPLACE FUNCTION public.floor_default_settings()
RETURNS jsonb LANGUAGE sql IMMUTABLE AS $$
  SELECT '{"bands":[{"from_ngn":0,"seconds":60},{"from_ngn":5000,"seconds":120},{"from_ngn":50000,"seconds":240},{"from_ngn":200000,"seconds":360}],"busy_threshold":10,"busy_shrink_pct":30,"min_seconds":45,"max_wait_seconds":1800}'::jsonb
$$;

ALTER TABLE public.platform_settings
  ADD COLUMN IF NOT EXISTS spray_floor_settings JSONB NOT NULL DEFAULT public.floor_default_settings();

COMMENT ON COLUMN public.platform_settings.spray_floor_settings IS
  'Dance floor turn bands, busy-floor rule and max wait. Write only via set_spray_floor_settings (validated).';

CREATE OR REPLACE FUNCTION public.floor_settings()
RETURNS jsonb LANGUAGE sql STABLE SECURITY DEFINER SET search_path = public AS $$
  SELECT COALESCE((SELECT spray_floor_settings FROM public.platform_settings WHERE id = 1), public.floor_default_settings())
$$;

CREATE OR REPLACE FUNCTION public.floor_band_seconds(p_settings jsonb, p_amount_kobo bigint)
RETURNS int LANGUAGE sql IMMUTABLE AS $$
  SELECT COALESCE(
    (SELECT (b->>'seconds')::int FROM jsonb_array_elements(p_settings->'bands') WITH ORDINALITY AS t(b, i)
      WHERE (b->>'from_ngn')::bigint * 100 <= p_amount_kobo ORDER BY i DESC LIMIT 1),
    (SELECT (b->>'seconds')::int FROM jsonb_array_elements(p_settings->'bands') WITH ORDINALITY AS t(b, i)
      ORDER BY i LIMIT 1)
  )
$$;

CREATE OR REPLACE FUNCTION public.floor_turn_seconds(p_settings jsonb, p_band_seconds int, p_waiting int)
RETURNS int LANGUAGE sql IMMUTABLE AS $$
  SELECT CASE
    WHEN p_waiting > (p_settings->>'busy_threshold')::int THEN
      GREATEST((p_settings->>'min_seconds')::int,
               round(p_band_seconds * (1 - (p_settings->>'busy_shrink_pct')::numeric / 100))::int)
    ELSE p_band_seconds
  END
$$;

-- Same integer formula as the app's sprayedNotes (src/lib/floor.ts).
CREATE OR REPLACE FUNCTION public.floor_charged_kobo(p_note_count int, p_denomination int, p_floor_seconds int, p_elapsed_ms bigint)
RETURNS bigint LANGUAGE sql IMMUTABLE AS $$
  SELECT (floor(p_note_count::numeric * LEAST(GREATEST(p_elapsed_ms, 0), p_floor_seconds::bigint * 1000)
                / (p_floor_seconds::bigint * 1000)))::bigint * p_denomination * 100
$$;

CREATE OR REPLACE FUNCTION public._floor_elapsed_ms(p_started timestamptz)
RETURNS bigint LANGUAGE sql STABLE AS $$
  SELECT floor(extract(epoch FROM (now() - p_started)) * 1000)::bigint
$$;

CREATE OR REPLACE FUNCTION public.floor_settings_errors(p jsonb)
RETURNS text LANGUAGE plpgsql STABLE SECURITY DEFINER SET search_path = public AS $$
DECLARE
  v_band jsonb;
  v_prev numeric := -1;
  v_count int;
  v_min_band int := NULL;
BEGIN
  IF jsonb_typeof(p->'bands') <> 'array' THEN RETURN 'bands must be a list'; END IF;
  v_count := jsonb_array_length(p->'bands');
  IF v_count < 1 OR v_count > 6 THEN RETURN 'Use 1 to 6 bands'; END IF;
  FOR v_band IN SELECT value FROM jsonb_array_elements(p->'bands') LOOP
    IF jsonb_typeof(v_band->'from_ngn') <> 'number' OR jsonb_typeof(v_band->'seconds') <> 'number' THEN
      RETURN 'Each band needs from_ngn and seconds';
    END IF;
    IF v_prev < 0 AND (v_band->>'from_ngn')::numeric <> 0 THEN
      RETURN 'The first band must start at ₦0';
    END IF;
    IF (v_band->>'from_ngn')::numeric <= v_prev OR (v_band->>'from_ngn')::numeric <> floor((v_band->>'from_ngn')::numeric) THEN
      RETURN 'Band amounts must be whole naira and go up';
    END IF;
    IF (v_band->>'seconds')::numeric NOT BETWEEN 15 AND 900 OR (v_band->>'seconds')::numeric <> floor((v_band->>'seconds')::numeric) THEN
      RETURN 'Band times must be whole seconds from 15 to 900';
    END IF;
    v_prev := (v_band->>'from_ngn')::numeric;
    v_min_band := LEAST(COALESCE(v_min_band, (v_band->>'seconds')::int), (v_band->>'seconds')::int);
  END LOOP;
  IF jsonb_typeof(p->'busy_threshold') <> 'number' OR (p->>'busy_threshold')::numeric < 1 THEN RETURN 'busy_threshold must be at least 1'; END IF;
  IF jsonb_typeof(p->'busy_shrink_pct') <> 'number' OR (p->>'busy_shrink_pct')::numeric NOT BETWEEN 0 AND 70 THEN RETURN 'busy_shrink_pct must be 0 to 70'; END IF;
  IF jsonb_typeof(p->'min_seconds') <> 'number' OR (p->>'min_seconds')::numeric < 15 OR (p->>'min_seconds')::numeric > v_min_band THEN
    RETURN 'min_seconds must be from 15 to the shortest band';
  END IF;
  IF jsonb_typeof(p->'max_wait_seconds') <> 'number' OR (p->>'max_wait_seconds')::numeric NOT BETWEEN 300 AND 7200 THEN
    RETURN 'max_wait_seconds must be 300 to 7200';
  END IF;
  RETURN NULL;
END;
$$;

CREATE OR REPLACE FUNCTION public.get_spray_floor_settings()
RETURNS jsonb LANGUAGE plpgsql STABLE SECURITY DEFINER SET search_path = public AS $$
BEGIN
  IF NOT (public.has_admin_role(auth.uid(), 'super_admin') OR public.has_admin_role(auth.uid(), 'finance')
          OR public.has_admin_role(auth.uid(), 'support')) THEN
    RAISE EXCEPTION 'Not authorized';
  END IF;
  RETURN public.floor_settings();
END;
$$;

CREATE OR REPLACE FUNCTION public.set_spray_floor_settings(p jsonb)
RETURNS jsonb LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
DECLARE v_err text;
BEGIN
  IF auth.uid() IS NULL OR NOT (public.has_admin_role(auth.uid(), 'super_admin') OR public.has_admin_role(auth.uid(), 'finance')) THEN
    RAISE EXCEPTION 'Not authorized';
  END IF;
  v_err := public.floor_settings_errors(p);
  IF v_err IS NOT NULL THEN RAISE EXCEPTION 'Invalid floor settings: %', v_err; END IF;
  UPDATE public.platform_settings
     SET spray_floor_settings = jsonb_build_object(
           'bands', p->'bands', 'busy_threshold', (p->>'busy_threshold')::int,
           'busy_shrink_pct', (p->>'busy_shrink_pct')::int, 'min_seconds', (p->>'min_seconds')::int,
           'max_wait_seconds', (p->>'max_wait_seconds')::int)
   WHERE id = 1;
  RETURN public.floor_settings();
END;
$$;

REVOKE ALL ON FUNCTION public.floor_settings() FROM PUBLIC, anon, authenticated;
REVOKE ALL ON FUNCTION public.floor_settings_errors(jsonb) FROM PUBLIC, anon, authenticated;
REVOKE ALL ON FUNCTION public.get_spray_floor_settings() FROM PUBLIC, anon, authenticated;
REVOKE ALL ON FUNCTION public.set_spray_floor_settings(jsonb) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.floor_settings() TO service_role;
GRANT EXECUTE ON FUNCTION public.floor_settings_errors(jsonb) TO service_role;
GRANT EXECUTE ON FUNCTION public.get_spray_floor_settings() TO authenticated, service_role;
GRANT EXECUTE ON FUNCTION public.set_spray_floor_settings(jsonb) TO authenticated, service_role;
