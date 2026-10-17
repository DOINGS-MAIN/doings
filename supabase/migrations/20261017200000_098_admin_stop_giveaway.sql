-- Migration 098: admins (moderation/finance) can stop an active giveaway. The remainder goes back to
-- the creator through stop_giveaway_funded; who stopped it and why is recorded, the creator is told,
-- and the stop is audited. Service_role only; called only by the admin edge function.

ALTER TABLE public.giveaways
  ADD COLUMN IF NOT EXISTS stopped_by uuid REFERENCES auth.users(id),
  ADD COLUMN IF NOT EXISTS stop_reason text;

CREATE OR REPLACE FUNCTION public.admin_stop_giveaway(p_giveaway_id uuid, p_admin_auth_id uuid, p_reason text)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_g public.giveaways%ROWTYPE;
  v_reason text := btrim(COALESCE(p_reason, ''));
  v_out jsonb;
  v_refunded bigint;
  v_body text;
BEGIN
  SELECT * INTO v_g FROM public.giveaways WHERE id = p_giveaway_id FOR UPDATE;
  IF NOT FOUND THEN RAISE EXCEPTION 'Giveaway not found'; END IF;
  IF v_g.status <> 'active' THEN RAISE EXCEPTION 'Giveaway is not active'; END IF;
  IF v_reason = '' THEN RAISE EXCEPTION 'A reason is required'; END IF;
  -- The reason goes into the creator's notification and the audit log.
  IF length(v_reason) > 500 THEN RAISE EXCEPTION 'Keep the reason under 500 characters'; END IF;

  -- The remainder only ever goes back to the creator.
  v_out := public.stop_giveaway_funded(v_g.creator_id, v_g.id);
  v_refunded := COALESCE((v_out->>'refunded')::bigint, 0);

  UPDATE public.giveaways SET stopped_by = p_admin_auth_id, stop_reason = v_reason WHERE id = v_g.id;

  -- No second full stop when the reason already ends a sentence.
  v_body := format('Your giveaway "%s" was stopped by Doings: %s', v_g.title, v_reason)
    || CASE WHEN right(v_reason, 1) IN ('.', '!', '?') THEN '' ELSE '.' END;
  IF v_refunded > 0 THEN
    v_body := v_body || format(' ₦%s was returned to your Bag.', btrim(to_char(v_refunded / 100.0, 'FM999G999G990D00')));
  END IF;
  PERFORM public.create_notification(v_g.creator_id, 'giveaway_stopped', 'Giveaway stopped', v_body,
    jsonb_build_object('giveaway_id', v_g.id, 'refunded', v_refunded));

  PERFORM public.log_admin_action(p_admin_auth_id, 'stop_giveaway', 'giveaway', v_g.id,
    jsonb_build_object('reason', v_reason, 'refunded', v_refunded, 'creator_id', v_g.creator_id));

  RETURN jsonb_build_object('giveaway_id', v_g.id, 'refunded', v_refunded,
    'refund_transaction_id', v_out->>'refund_transaction_id');
END;
$$;

REVOKE ALL ON FUNCTION public.admin_stop_giveaway(uuid, uuid, text) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.admin_stop_giveaway(uuid, uuid, text) TO service_role;
