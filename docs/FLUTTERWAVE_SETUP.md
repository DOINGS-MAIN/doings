# Flutterwave setup

[Flutterwave](https://developer.flutterwave.com) is registered in `psp_providers` as `flutterwave`. It supports wallet funding (permanent virtual accounts), bank disbursements, and account name resolution.

## Secrets (Supabase Edge Functions)

| Secret | Description |
|--------|-------------|
| `FLUTTERWAVE_SECRET_KEY` | Secret key from Flutterwave dashboard → Settings → API |
| `FLUTTERWAVE_WEBHOOK_SECRET_HASH` | Secret hash from dashboard → Settings → Webhooks (sent as `verif-hash` header) |
| `FLUTTERWAVE_PUBLIC_KEY` | Optional — only needed if you add card/checkout flows later |
| `FLUTTERWAVE_DEFAULT_PHONE` | Optional fallback phone for VA creation (11 digits, e.g. `08012345678`) |
| `FLUTTERWAVE_WEBHOOK_SKIP_PAYER_NAME_CHECK` | `true` in dev only — skips AML payer-name match on inbound transfers |
| `FLUTTERWAVE_TRANSFER_CALLBACK_URL` | Optional — same as your `webhook-flutterwave` URL for transfer status callbacks |

Optional: `FLUTTERWAVE_API_BASE` (defaults to `https://api.flutterwave.com/v3`).

## Withdrawals (API payouts) — required dashboard setup

**Deposits can work while withdrawals fail** if payout security is not configured. Flutterwave blocks `POST /v3/transfers` unless:

1. **API payouts are enabled**  
   Flutterwave dashboard → **Settings** → payout source / permissions → allow payouts via **API** (not dashboard-only).

2. **IP whitelisting is configured**  
   Settings → **Whitelisted IP addresses** → add at least one entry.

   Supabase Edge Functions use **dynamic egress IPs**, so you cannot whitelist a single server IP easily. For serverless backends Flutterwave supports whitelisting **`0.0.0.0`** to allow API payouts from any IP (use while on Supabase; tighten later if you move to a static-IP host).

   Without this, transfers fail with:  
   `Please enable IP Whitelisting to access this service`

3. **Payout balance** — your Flutterwave balance must cover the transfer + Flutterwave fees.

4. **Webhooks** — subscribe to `transfer.completed` and `transfer.failed` (see below).

Failed transfers in Doings call `fail_withdrawal`, so the user's wallet balance is released when Flutterwave rejects the payout.

**Common failure after IP whitelist is fixed:**  
`DISBURSE FAILED: Insufficient funds in customer wallet` — this refers to your **Flutterwave merchant payout balance**, not the user's Doings wallet. VA deposits may sit in collections/settlement before they are available for API transfers. In the Flutterwave dashboard, check **Balances** / **Transfers** and ensure enough NGN is available for disbursements (or move funds from collections to payout if your account uses separate wallets).

```bash
npx supabase secrets set \
  FLUTTERWAVE_SECRET_KEY='FLWSECK-...' \
  FLUTTERWAVE_WEBHOOK_SECRET_HASH='your-dashboard-secret-hash' \
  FLUTTERWAVE_TRANSFER_CALLBACK_URL='https://<project-ref>.supabase.co/functions/v1/webhook-flutterwave'
```

```bash
npx supabase secrets set \
  FLUTTERWAVE_SECRET_KEY='FLWSECK_TEST-...' \
  FLUTTERWAVE_WEBHOOK_SECRET_HASH='your-dashboard-secret-hash'
```

## Webhooks

Configure in Flutterwave dashboard → Settings → Webhooks (**V3 Live webhooks**):

```
https://<project-ref>.supabase.co/functions/v1/webhook-flutterwave
```

**Important:** Use the full URL including `webhook-flutterwave`. Do **not** end the URL with `/functions/v1` or `/functions/v1.` — Flutterwave will never reach your handler.

Also recommended:
- Enable **webhook retries** (so a transient failure does not lose the deposit notification)
- Copy the **secret hash** exactly into Supabase as `FLUTTERWAVE_WEBHOOK_SECRET_HASH`

`supabase/config.toml` sets `verify_jwt = false` for this function. Redeploy after config changes:

```bash
npx supabase functions deploy webhook-flutterwave
```

Subscribe to these events:

| Subscribe | Event | Why |
|-----------|-------|-----|
| **Yes** | `charge.completed` | Credits wallets when a bank transfer hits a user's virtual account |
| **Yes** | `transfer.completed` | Marks NGN withdrawals as completed |
| **Yes** | `transfer.failed` | Marks failed withdrawals and releases held balance |
| No | Card / mobile money events | Not used for Doings wallet VA funding |

Our handler only credits inbound `charge.completed` events where `payment_type` is `bank_transfer` and `status` is `successful`.

## Virtual accounts

- Created via `POST /v3/virtual-account-numbers` with `is_permanent: true`
- Requires an 11-digit **BVN** (same UX as Monnify in the Fund Wallet sheet)
- `tx_ref` is stored as `account_reference` (`doings-fw-{userId}`)
- Webhook matching uses `tx_ref` or `account_number` against `reserved_accounts`

## Admin

Set `wallet_funding_provider_id` and/or `disbursement_provider_id` to `flutterwave` in **Admin → Payment Rails**.

Provider is registered as `active` in the catalog. Flutterwave uses the same API host for test and live — your **secret key prefix** (`FLWSECK_TEST-` vs live) determines the environment, not a separate base URL.

## Deploy

```bash
npx supabase db push
npx supabase functions deploy create-ngn-account webhook-flutterwave withdraw-ngn verify-bank-account list-banks withdrawal-reconcile --project-ref <ref>
```

## Sandbox testing

Skip sandbox if you are using **live keys** (`FLWSECK-...` without `TEST`). Migration `036_flutterwave_production` sets `psp_env = production` and routes funding + disbursement through Flutterwave.

1. Confirm live secrets in Supabase (`FLUTTERWAVE_SECRET_KEY`, `FLUTTERWAVE_WEBHOOK_SECRET_HASH`)
2. Register the production webhook URL in Flutterwave dashboard
3. Admin → Payment Rails → **Run health checks** on Flutterwave
4. User with KYC L2 → Fund wallet → enter BVN → copy VA → send a small real transfer
5. Confirm wallet credited; check Admin → Webhooks + PSP Activity

## API reference

- Virtual account: `POST /v3/virtual-account-numbers`
- Bank resolve: `POST /v3/accounts/resolve`
- Transfer: `POST /v3/transfers`
- Transfer status: `GET /v3/transfers?reference=...`
