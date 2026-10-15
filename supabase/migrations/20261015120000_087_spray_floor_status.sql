-- Dance floor queue (part 1): statuses for floor sprays. Added on their own because a new enum
-- value cannot be used in the transaction that adds it. Old-app sprays keep pending/expired.
ALTER TYPE public.spray_hold_status ADD VALUE IF NOT EXISTS 'queued';
ALTER TYPE public.spray_hold_status ADD VALUE IF NOT EXISTS 'on_floor';
