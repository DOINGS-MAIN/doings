# Supabase Backend Execution Plan

This project now includes the full migration batch from `public/docs`.

## Implemented now

- `20260326000000_001_extensions_enums.sql`
- `20260326010000_002_users_table.sql`
- `20260326020000_003_admin_roles.sql`
- `20260326030000_004_kyc_verifications.sql`
- `20260326040000_005_wallets_addresses.sql`
- `20260326050000_006_transactions_ledger.sql`
- `20260326060000_007_transfers_bank_accounts.sql`
- `20260326070000_008_monnify_reserved_accounts.sql`
- `20260326080000_009_events_participants.sql`
- `20260326090000_010_spray_records.sql`
- `20260326100000_011_giveaways_redemptions.sql`
- `20260326110000_012_webhook_logs_notifications.sql`
- `20260326120000_013_leaderboard_materialized_views.sql`
- `20260326130000_014_row_level_security_policies.sql`
- `20260326140000_015_server_side_functions.sql`
- `20260326150000_016_admin_audit_log.sql`
- `20260326160000_017_seed_initial_super_admin.sql`

## Run locally

```bash
supabase init
supabase start
supabase db reset
supabase db lint
```

## Verify migration status

Run in Supabase SQL editor or `psql`:

```sql
SELECT table_name
FROM information_schema.tables
WHERE table_schema = 'public'
ORDER BY table_name;

SELECT typname
FROM pg_type
WHERE typnamespace = 'public'::regnamespace
  AND typtype = 'e'
ORDER BY typname;

INSERT INTO public.users (phone) VALUES ('+2348000000001');

SELECT currency, balance
FROM public.wallets
WHERE user_id = (SELECT id FROM public.users WHERE phone = '+2348000000001')
ORDER BY currency;
```

## Completed — P0 (core infrastructure)

1. Edge functions (MVP active):
   - `kyc-dojah-verify` — KYC level 2/3 with rate limiting
   - `webhook-monnify` — NGN deposit credit + disbursement callback handling
   - `webhook-blockradar` — USDT deposit credit + withdrawal callback handling
   - `create-monnify-account` — create Monnify reserved account on KYC level 2
   - `create-blockradar-address` — generate USDT deposit address on KYC level 2
   - `spray` — debit sprayer, credit host, write spray_record
   - `events` — create/update/delete/go-live/end/join/list events + lookup by code
2. Database hooks:
   - `019_auth_signup_hook` — auto-create public.users + wallets on Supabase Auth signup

## Completed — P1 (money movement + transfers)

1. New migration:
   - `020_withdrawal_functions.sql` — `lock_withdrawal`, `complete_withdrawal`, `fail_withdrawal` RPCs
2. Edge functions:
   - `withdraw-ngn` — lock balance, call Monnify disbursement, auto-release on failure
   - `withdraw-usdt` — lock balance, call Blockradar send, auto-release on failure
   - `transfer` — phone-number lookup + `internal_transfer` RPC (NGN & USDT)
   - `verify-bank-account` — Monnify account name lookup before saving
3. Updated shared helpers:
   - `_shared/monnify.ts` — added `disburseFunds()` for Monnify disbursement API
4. Webhook handler upgrades:
   - `webhook-monnify` — now handles `SUCCESSFUL_DISBURSEMENT` / `FAILED_DISBURSEMENT` via `complete_withdrawal` / `fail_withdrawal`
   - `webhook-blockradar` — now uses `complete_withdrawal` / `fail_withdrawal` instead of raw table updates

## Completed — P2 (full feature set)

1. Giveaway flow (`giveaway` edge function):
   - `POST /` — create giveaway (debit creator's wallet, lock total pool)
   - `POST /redeem` — redeem by code (credit recipient, track in giveaway_redemptions)
   - `POST /stop` — stop giveaway (refund remaining_amount to creator)
   - `GET /`, `GET /:id`, `GET /code/:code` — list/lookup
2. Notification triggers (`021_notification_triggers.sql`):
   - Deposit completed, withdrawal completed/failed
   - Spray received (notifies receiver)
   - KYC approved/rejected
   - Giveaway redeemed (notifies creator)
   - Helper function `create_notification()` for reuse
3. Notifications API (`notifications` edge function):
   - `GET` — list notifications (with unread count, optional unread-only filter)
   - `POST` — mark single or all as read
4. Leaderboard refresh (`cron-leaderboard` edge function):
   - Protected by `CRON_SECRET` bearer token
   - Calls `refresh_leaderboards()` to update weekly/monthly/alltime materialized views
5. Reconciliation job (`cron-reconciliation` edge function):
   - Protected by `CRON_SECRET` bearer token
   - Calls `reconcile_wallets()`, logs discrepancies to admin_audit_log, creates system alerts

## Completed — P3 (admin + hardening)

1. Admin API (`admin` edge function):
   - `GET /stats` — dashboard stats (users, transactions, volume, events, KYC)
   - `GET/POST /users` — list, get, suspend, unsuspend, ban (with audit logging)
   - `GET/POST /transactions` — list, get, flag (with audit logging)
   - `GET/POST /kyc` — list pending, approve, reject (with audit logging)
   - `GET/POST /events` — list, force-end (with audit logging)
   - `GET/POST /team` — list, invite, disable, enable admin team members
   - `GET /audit` — paginated audit log viewer
   - All endpoints require active `admin_roles` entry, super_admin-only for team management
2. Frontend Supabase client (`src/lib/supabase.ts`):
   - Typed helpers for auth (OTP), KYC, wallet, transfers, withdrawals, events, spray, giveaways, notifications, admin
   - Auto-attaches auth token to all edge function calls
3. Rate limiting (`_shared/rate-limit.ts`):
   - In-memory sliding-window rate limiter with auto-cleanup
   - Wired into `withdraw-ngn` (5/min), `withdraw-usdt` (5/min), `transfer` (10/min)
   - Pre-built configs for spray (30/min), KYC (3/hr), giveaway redeem (10/min)
4. Anomaly detection (`022_anomaly_detection.sql`):
   - `transaction_flags` table with severity levels and resolution tracking
   - Auto-flag large transactions (>₦500k / >500 USDT) with severity scaling
   - Auto-flag high-frequency patterns (>10 same-type txns in 5 min)
   - Auto-flag repeated withdrawal failures (>3 in 1 hour)

## Dormant (deploy later when needed)

- `webhook-quidax` — USDT deposit/withdraw via exchange (code ready, not deployed for MVP)

## Live deploy checklist

See `supabase/LIVE_DEPLOY_AND_INTEGRATION_TEST.md`

## Notes

- Money is stored as `BIGINT` smallest units (kobo/micro-USDT).
- Keep provider credentials only in Supabase secrets.
- Run migrations in timestamp order only.
