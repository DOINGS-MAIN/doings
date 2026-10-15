DO $$
DECLARE s jsonb := public.floor_default_settings();
BEGIN
  -- smoke: helpers work against this database
  ASSERT pg_temp.mk_user('floor-smoke@test.local', 100000) IS NOT NULL, 'mk_user';

  -- bands
  ASSERT public.floor_band_seconds(s, 20000) = 60, '₦200 is the 1 min band';
  ASSERT public.floor_band_seconds(s, 480000) = 60, '₦4,800 is 1 min';
  ASSERT public.floor_band_seconds(s, 500000) = 120, '₦5,000 is 2 min';
  ASSERT public.floor_band_seconds(s, 4980000) = 120, '₦49,800 is 2 min';
  ASSERT public.floor_band_seconds(s, 5000000) = 240, '₦50,000 is 4 min (user: 50k must get more than 2)';
  ASSERT public.floor_band_seconds(s, 20000000) = 360, '₦200,000 is 6 min';
  ASSERT public.floor_band_seconds(s, 100000000) = 360, '₦1M is 6 min';

  -- busy floor: > 10 waiting shrinks 30%, never below 45 s
  ASSERT public.floor_turn_seconds(s, 240, 10) = 240, 'at the threshold no shrink';
  ASSERT public.floor_turn_seconds(s, 240, 11) = 168, '240 × 0.7';
  ASSERT public.floor_turn_seconds(s, 60, 11) = 45, 'floored at min_seconds';

  -- charge maths: ₦50,000 in ₦200 notes = 250 notes over 240 s
  ASSERT public.floor_charged_kobo(250, 200, 240, -5) = 0, 'negative elapsed';
  ASSERT public.floor_charged_kobo(250, 200, 240, 0) = 0, 'start';
  ASSERT public.floor_charged_kobo(250, 200, 240, 120000) = 2500000, 'half = 125 notes';
  ASSERT public.floor_charged_kobo(250, 200, 240, 239999) = 4980000, '249 notes just before the end';
  ASSERT public.floor_charged_kobo(250, 200, 240, 240000) = 5000000, 'full';
  ASSERT public.floor_charged_kobo(250, 200, 240, 999999) = 5000000, 'clamped at full';

  -- validation
  ASSERT public.floor_settings_errors(s) IS NULL, 'defaults are valid';
  ASSERT public.floor_settings_errors(jsonb_set(s, '{bands,0,seconds}', '60000')) IS NOT NULL, '1000-minute typo rejected';
  ASSERT public.floor_settings_errors(jsonb_set(s, '{bands,2,from_ngn}', '4000')) IS NOT NULL, 'bands must ascend';
  ASSERT public.floor_settings_errors(jsonb_set(s, '{bands,0,from_ngn}', '200')) IS NOT NULL, 'first band must start at 0';
  ASSERT public.floor_settings_errors(jsonb_set(s, '{busy_shrink_pct}', '71')) IS NOT NULL, 'shrink cap';
  ASSERT public.floor_settings_errors(jsonb_set(s, '{min_seconds}', '61')) IS NOT NULL, 'min above smallest band';
  ASSERT public.floor_settings_errors(jsonb_set(s, '{max_wait_seconds}', '120')) IS NOT NULL, 'max wait too short';
  ASSERT public.floor_settings_errors(jsonb_set(s, '{bands}', '[]')) IS NOT NULL, 'no bands';
  ASSERT public.floor_settings() = s, 'live settings start at the defaults';
END $$;

-- the setter refuses non-admins (no JWT here, so auth.uid() is null)
DO $$
BEGIN
  BEGIN
    PERFORM public.set_spray_floor_settings(public.floor_default_settings());
    RAISE EXCEPTION 'expected Not authorized';
  EXCEPTION WHEN others THEN
    ASSERT SQLERRM LIKE '%Not authorized%', SQLERRM;
  END;
END $$;

SELECT 'settings tests passed' AS result;
