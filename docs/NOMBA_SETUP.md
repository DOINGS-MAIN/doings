# Nomba (Nombank) setup

[Nomba](https://developer.nomba.com) is registered in `psp_providers` as `nomba`. It supports wallet funding (virtual accounts) and bank disbursements.

## Secrets (Supabase Edge Functions)

| Secret | Description |
|--------|-------------|
| `NOMBA_CLIENT_ID` | From Nomba dashboard → API keys |
| `NOMBA_CLIENT_SECRET` | OAuth client secret |
| `NOMBA_ACCOUNT_ID` | Parent `accountId` header (UUID) |
| `NOMBA_SANDBOX` | `true` → sandbox base URL |
| `NOMBA_WEBHOOK_SECRET` | **You choose this** — same value as the “signature key” in Nomba Webhook Setup |
| `NOMBA_WEBHOOK_SKIP_PAYER_NAME_CHECK` | `true` in dev only |

Optional: `NOMBA_API_BASE_SANDBOX`, `NOMBA_API_BASE_PROD`.

## Webhook signature key

Nomba does **not** generate the signature key for you. You pick a strong random secret, enter it in **Developer → Webhook Setup → signature key**, and store the **exact same string** in Supabase:

```bash
# generate one (example)
openssl rand -base64 32

# set in Supabase (use the same value in Nomba dashboard)
npx supabase secrets set NOMBA_WEBHOOK_SECRET='your-generated-secret'
```

Nomba signs each webhook with `nomba-signature` (HMAC-SHA256, base64) using that key. Our `webhook-nomba` function verifies it when `NOMBA_WEBHOOK_SECRET` is set.

## Webhooks

Configure in Nomba dashboard:

```
https://<project-ref>.supabase.co/functions/v1/webhook-nomba
```

`supabase/config.toml` sets `verify_jwt = false` for this function so Nomba can POST without a Supabase JWT (auth is via `NOMBA_WEBHOOK_SECRET` + `nomba-signature` instead). Redeploy after changing config:

```bash
npx supabase functions deploy webhook-nomba
```

Subscribe to these Nomba events in **Developer → Webhook Setup**:

| Subscribe | Event | Why |
|-----------|-------|-----|
| **Yes** | `payment_success` | Credits user wallets when money hits their Nomba virtual account |
| **Yes** | `payout_success` | Marks NGN withdrawals as completed |
| **Yes** | `payout_failed` | Marks failed withdrawals and releases held balance |
| **Recommended** | `payout_refund` | Handles reversed/refunded payouts |
| No | `payment_failed` | Not used (failed inbound transfers are not credited) |
| No | Card / POS / checkout events | Not used for Doings wallet VA funding |

## Admin

Set `wallet_funding_provider_id` and/or `disbursement_provider_id` to `nomba` in `platform_settings` (Payment Rails UI in Phase 4).

## Deploy

```bash
npx supabase functions deploy create-ngn-account webhook-nomba withdraw-ngn verify-bank-account withdrawal-reconcile --project-ref <ref>
npx supabase db push
```

## Sandbox limits (Nomba docs)

- Max **2** virtual accounts per user in sandbox
- Max **₦150** per inbound transfer in sandbox

## API reference

- Virtual account: `POST /v1/accounts/virtual`
- Bank lookup: `POST /v1/transfers/bank/lookup`
- Transfer: `POST /v2/transfers/bank`
- Requery: `GET /v1/transactions/accounts/single?transactionRef=...`
