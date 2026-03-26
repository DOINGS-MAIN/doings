# Live Supabase Deploy & Integration Test

Complete checklist to deploy backend to a live Supabase project.
Quidax is dormant for MVP — do not deploy or configure it until needed.

---

## Step 1 — Login & link project

```bash
supabase login
supabase link --project-ref <YOUR_PROJECT_REF>
```

Get your project ref from: https://supabase.com/dashboard/project/_/settings/general

## Step 2 — Push all 22 migrations

```bash
supabase db push
```

This applies in timestamp order:
- 001–017: Core schema (users, wallets, events, sprays, giveaways, KYC, RLS, functions, admin)
- 018: Webhook idempotency index
- 019: Auth signup hook (auto-create users + wallets)
- 020: Withdrawal functions (lock/complete/fail)
- 021: Notification triggers
- 022: Anomaly detection triggers + transaction_flags table

Verify tables exist:

```sql
SELECT table_name FROM information_schema.tables
WHERE table_schema = 'public' ORDER BY table_name;
```

## Step 3 — Set all secrets

```bash
supabase secrets set \
  DOJAH_APP_ID="<dojah-app-id>" \
  DOJAH_SECRET_KEY="<dojah-secret>" \
  MONNIFY_WEBHOOK_SECRET="<monnify-webhook-secret>" \
  MONNIFY_API_KEY="<monnify-api-key>" \
  MONNIFY_SECRET_KEY="<monnify-secret-key>" \
  MONNIFY_CONTRACT_CODE="<monnify-contract-code>" \
  MONNIFY_BASE_URL="https://api.monnify.com" \
  MONNIFY_SOURCE_ACCOUNT="<monnify-source-account-number>" \
  BLOCKRADAR_WEBHOOK_SECRET="<blockradar-webhook-secret>" \
  BLOCKRADAR_API_KEY="<blockradar-api-key>" \
  BLOCKRADAR_WALLET_ID="<blockradar-wallet-id>" \
  CRON_SECRET="<random-uuid-for-cron-auth>"
```

Notes:
- `SUPABASE_URL`, `SUPABASE_ANON_KEY`, `SUPABASE_SERVICE_ROLE_KEY` are auto-injected by Supabase
- `MONNIFY_SOURCE_ACCOUNT` is your Monnify source account number for disbursements
- `CRON_SECRET` protects the leaderboard/reconciliation cron endpoints
- Quidax secrets — skip for MVP

## Step 4 — Deploy all 16 edge functions

```bash
# P0 — Core
supabase functions deploy kyc-dojah-verify
supabase functions deploy webhook-monnify
supabase functions deploy webhook-blockradar
supabase functions deploy create-monnify-account
supabase functions deploy create-blockradar-address
supabase functions deploy spray
supabase functions deploy events

# P1 — Money movement
supabase functions deploy withdraw-ngn
supabase functions deploy withdraw-usdt
supabase functions deploy transfer
supabase functions deploy verify-bank-account

# P2 — Features
supabase functions deploy giveaway
supabase functions deploy notifications
supabase functions deploy cron-leaderboard
supabase functions deploy cron-reconciliation

# P3 — Admin
supabase functions deploy admin

# Dormant — skip for MVP:
# supabase functions deploy webhook-quidax
```

Or deploy all at once:

```bash
supabase functions deploy --all
```

(This will also deploy webhook-quidax which is fine — it just won't receive any webhooks without the Quidax secret configured.)

## Step 5 — Configure provider webhook URLs

In each provider's dashboard, set the webhook URL:

- **Monnify**: `https://<project-ref>.supabase.co/functions/v1/webhook-monnify`
- **Blockradar**: `https://<project-ref>.supabase.co/functions/v1/webhook-blockradar`

## Step 6 — Set up cron schedules

In the Supabase dashboard (Database → Extensions → pg_cron), or via SQL:

```sql
-- Refresh leaderboards every 15 minutes
SELECT cron.schedule(
  'refresh-leaderboards',
  '*/15 * * * *',
  $$SELECT net.http_post(
    url := current_setting('app.settings.supabase_url') || '/functions/v1/cron-leaderboard',
    headers := jsonb_build_object('Authorization', 'Bearer ' || current_setting('app.settings.cron_secret')),
    body := '{}'::jsonb
  )$$
);

-- Reconciliation daily at 3 AM UTC
SELECT cron.schedule(
  'reconcile-wallets',
  '0 3 * * *',
  $$SELECT net.http_post(
    url := current_setting('app.settings.supabase_url') || '/functions/v1/cron-reconciliation',
    headers := jsonb_build_object('Authorization', 'Bearer ' || current_setting('app.settings.cron_secret')),
    body := '{}'::jsonb
  )$$
);
```

Alternatively, use an external cron (e.g., cron-job.org or GitHub Actions) to POST to these URLs with the CRON_SECRET bearer token.

## Step 7 — Frontend environment variables

Create `event-spark/.env` (or set in your hosting platform):

```env
VITE_SUPABASE_URL=https://<project-ref>.supabase.co
VITE_SUPABASE_ANON_KEY=<anon-key>
```

## Step 8 — Integration test flow

### 8a. Signup

```bash
# Triggers OTP via Supabase Auth SMS
# Auth signup hook auto-creates public.users + NGN/USDT wallets
```

Verify:
```sql
SELECT id, phone, kyc_level, status FROM public.users ORDER BY created_at DESC LIMIT 5;
SELECT user_id, currency, balance FROM public.wallets ORDER BY created_at DESC LIMIT 10;
```

### 8b. KYC verification

Call `kyc-dojah-verify` with a BVN → confirm `kyc_verifications` row created, `users.kyc_level` = 2, `users.full_name` populated.

### 8c. Monnify reserved account

Call `create-monnify-account` → confirm row in `monnify_reserved_accounts` with `restrict_payment_source = true`.

### 8d. NGN deposit

Transfer money to the reserved account via Monnify sandbox → webhook fires → check:

```sql
SELECT * FROM public.webhook_logs WHERE provider = 'monnify' ORDER BY created_at DESC LIMIT 5;
SELECT * FROM public.transactions WHERE type = 'deposit' ORDER BY created_at DESC LIMIT 5;
```

### 8e. Spray

Create event → go live → spray from another user → check `spray_records` and wallet balances.

### 8f. Withdrawal

Call `withdraw-ngn` → check:
- Transaction in `pending` status with locked balance
- Monnify disbursement callback → `completed` or `failed`
- Locked balance released

### 8g. Giveaway

Create giveaway → redeem with code from another user → stop → verify refund.

### 8h. Notifications

```sql
SELECT user_id, type, title, body, read, created_at
FROM public.notifications ORDER BY created_at DESC LIMIT 20;
```

### 8i. Anomaly detection

```sql
SELECT * FROM public.transaction_flags WHERE resolved = false ORDER BY created_at DESC;
```

### 8j. Reconciliation

```sql
SELECT * FROM public.reconcile_wallets();
-- Expected: zero rows (no discrepancies)
```

## Step 9 — Go-live safety checks

- [ ] All webhook signatures verified in live mode
- [ ] KYC + tier-based withdrawal limits active
- [ ] Rate limiting active on financial endpoints
- [ ] No secrets in frontend code or git repo
- [ ] `webhook_logs` shows `processing_error IS NULL` for recent entries
- [ ] `transaction_flags` reviewed and resolved
- [ ] Monnify reserved accounts use `restrictPaymentSource: true`
- [ ] AML deposit name check active in webhook-monnify
- [ ] Admin audit log capturing actions
- [ ] Cron jobs running (leaderboard + reconciliation)
