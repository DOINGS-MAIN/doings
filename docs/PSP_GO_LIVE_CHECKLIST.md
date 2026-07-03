# PSP go-live checklist

Use this before switching `psp_env` to **production** or changing active funding/disbursement providers.

## 1. Database & secrets

- [ ] `npx supabase db push` — migrations through `035_flutterwave_psp` applied
- [ ] Monnify secrets set (`MONNIFY_API_KEY`, `MONNIFY_SECRET_KEY`, `MONNIFY_CONTRACT_CODE`, `MONNIFY_DISBURSEMENT_SOURCE_ACCOUNT`)
- [ ] Nomba secrets set if using Nomba (`NOMBA_CLIENT_ID`, `NOMBA_CLIENT_SECRET`, `NOMBA_ACCOUNT_ID`, `NOMBA_WEBHOOK_SECRET`)
- [ ] Flutterwave secrets set if using Flutterwave (`FLUTTERWAVE_SECRET_KEY`, `FLUTTERWAVE_WEBHOOK_SECRET_HASH`)
- [ ] `CRON_SECRET` set for `withdrawal-reconcile` cron

## 2. Edge functions deployed

```bash
npx supabase functions deploy admin create-ngn-account webhook-monnify webhook-nomba webhook-flutterwave \
  withdraw-ngn verify-bank-account withdrawal-reconcile kyc-dojah-verify
```

## 3. Webhooks registered

| Provider | URL |
|----------|-----|
| Monnify | `https://<ref>.supabase.co/functions/v1/webhook-monnify` |
| Nomba | `https://<ref>.supabase.co/functions/v1/webhook-nomba` (`verify_jwt = false` in `config.toml`) |
| Flutterwave | `https://<ref>.supabase.co/functions/v1/webhook-flutterwave` (`verify_jwt = false` in `config.toml`) |

## 4. Sandbox E2E (run in order)

### Funding (active wallet funding provider)

1. Admin → Payment Rails — confirm funding provider + sandbox env
2. User with KYC L2 → Fund wallet → create NGN account
3. Send sandbox transfer to VA (Nomba sandbox max ₦150)
4. Confirm wallet credited; check Admin → PSP Activity + Webhooks

### Disbursement (active disbursement provider)

1. User adds bank account → verify name resolves
2. Withdraw ≥ ₦1,000
3. Confirm status moves `pending` → `processing` → `completed`
4. If stuck >15 min, confirm reconcile cron finalizes (or check Admin → Review Queue)

### Admin ops

1. Admin → Payment Rails → **Run health checks** — all providers green
2. Admin → Review Queue — empty after successful flows
3. Test flag / unflag / refund on a test deposit (finance role)

## 5. Production promotion

- [ ] Production credentials verified via health checks
- [ ] Webhooks re-registered on production URLs
- [ ] Admin → Payment Rails → switch `psp_env` to **production** (confirmation dialog)
- [ ] Switch funding/disbursement providers only when ready — **affects new operations only**
- [ ] Monitor Admin → Payments Overview for first 24h

## 6. Rollback

- Switch `psp_env` back to sandbox if testing
- Revert `wallet_funding_provider_id` / `disbursement_provider_id` to last known-good provider
- In-flight transactions keep their original provider; reconcile cron continues polling

## 7. Ongoing ops

- Review **Review Queue** daily
- Reprocess failed webhooks from Admin → Webhooks (finance only)
- Export CSV from Transactions / Webhooks / PSP Activity for audits
