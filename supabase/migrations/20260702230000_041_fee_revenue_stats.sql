-- Migration 041: Fee revenue stats + backfill fee column on withdrawals
-- =================================================================

-- Some withdrawals debited amount+fee (net_amount) but fee stayed 0 when older code omitted p_fee.
UPDATE public.transactions
SET fee = ABS(net_amount) - ABS(amount),
    updated_at = now()
WHERE type = 'withdrawal'
  AND status = 'completed'
  AND fee = 0
  AND ABS(net_amount) > ABS(amount);

-- Also backfill from metadata when present.
UPDATE public.transactions
SET fee = (metadata->'fee_breakdown'->>'total_fee_kobo')::bigint,
    updated_at = now()
WHERE type = 'withdrawal'
  AND status = 'completed'
  AND fee = 0
  AND (metadata->'fee_breakdown'->>'total_fee_kobo')::bigint > 0;

CREATE OR REPLACE FUNCTION public.get_fee_revenue_stats()
RETURNS jsonb
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path = public
AS $$
  WITH fee_rows AS (
    SELECT
      COALESCE(
        NULLIF(t.fee, 0),
        NULLIF((t.metadata->'fee_breakdown'->>'total_fee_kobo')::bigint, 0),
        CASE
          WHEN ABS(t.net_amount) > ABS(t.amount)
            THEN ABS(t.net_amount) - ABS(t.amount)
          ELSE 0
        END
      ) AS fee_kobo,
      t.created_at
    FROM public.transactions t
    WHERE t.status = 'completed'
      AND t.type = 'withdrawal'
  ),
  positive AS (
    SELECT fee_kobo, created_at
    FROM fee_rows
    WHERE fee_kobo > 0
  )
  SELECT jsonb_build_object(
    'total_fee_kobo', COALESCE((SELECT SUM(fee_kobo) FROM positive), 0),
    'today_fee_kobo', COALESCE((
      SELECT SUM(fee_kobo) FROM positive
      WHERE created_at >= date_trunc('day', now() AT TIME ZONE 'UTC')
    ), 0)
  );
$$;

GRANT EXECUTE ON FUNCTION public.get_fee_revenue_stats() TO service_role;
