-- SECURITY: debit_wallet returns the existing transaction for a repeated idempotency key without
-- debiting again, but create_giveaway_funded would still insert a new giveaway "funded" by it —
-- an unfunded giveaway that redeemers could drain. One funding transaction may back at most one
-- giveaway; a duplicate now fails and rolls the whole create back. (No existing duplicates.)

CREATE UNIQUE INDEX IF NOT EXISTS uq_giveaways_funding_transaction
  ON public.giveaways (funding_transaction_id)
  WHERE funding_transaction_id IS NOT NULL;
