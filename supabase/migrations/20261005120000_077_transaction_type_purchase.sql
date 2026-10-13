-- Bundles phase 2: bundle purchases get their own transaction type (not "deposit").
-- Separate migration: a new enum value can't be used in the transaction that adds it.
ALTER TYPE public.transaction_type ADD VALUE IF NOT EXISTS 'purchase';
