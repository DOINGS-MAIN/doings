-- Allow creators to see redemptions for giveaways they own, and users to see their own redemptions.
-- Required for PostgREST embeds like giveaway_redemptions(count) from the client.

CREATE POLICY "Users can view redemptions for own giveaways"
  ON public.giveaway_redemptions FOR SELECT TO authenticated
  USING (
    giveaway_id IN (
      SELECT id FROM public.giveaways
      WHERE creator_id IN (
        SELECT id FROM public.users WHERE auth_id = auth.uid()
      )
    )
  );

CREATE POLICY "Users can view own giveaway redemptions"
  ON public.giveaway_redemptions FOR SELECT TO authenticated
  USING (
    user_id IN (SELECT id FROM public.users WHERE auth_id = auth.uid())
  );
