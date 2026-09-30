-- SECURITY: "Users can create giveaways" let any authenticated user INSERT a giveaway row directly
-- (any total/remaining amount, no wallet debit). redeem_giveaway_code then credits redeemers from
-- that unfunded row. All legitimate creation goes through the `giveaway` edge function →
-- create_giveaway_funded (service role, debits the creator first), which RLS does not affect.

DROP POLICY IF EXISTS "Users can create giveaways" ON public.giveaways;
