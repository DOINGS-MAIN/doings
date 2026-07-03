# Withdrawal reconcile cron

Polls stuck NGN withdrawals (`pending` / `processing` older than 15 minutes) and finalizes them via the active disbursement PSP.

## Deploy

```bash
npx supabase functions deploy withdrawal-reconcile --project-ref <ref>
npx supabase db push
```

## Secrets

| Secret | Description |
|--------|-------------|
| `CRON_SECRET` | Bearer token for cron invocations (same as `cron-reconciliation`) |
| `WITHDRAWAL_RECONCILE_MINUTES` | Optional. Default `15` |
| `WITHDRAWAL_RECONCILE_BATCH` | Optional. Default `25` |

## Schedule (Supabase Dashboard → Edge Functions → Cron)

```
POST https://<project-ref>.supabase.co/functions/v1/withdrawal-reconcile
Authorization: Bearer <CRON_SECRET>
```

Suggested schedule: every **5 minutes**.

## Flow

1. Load stuck withdrawal transactions.
2. Poll PSP status using `idempotency_key` as merchant reference.
3. `terminal_success` → `complete_withdrawal`
4. `terminal_failure` → `fail_withdrawal` (releases locked funds)
5. `non_terminal` → mark `processing`, retry on next cron run

Events are written to `psp_events` for admin monitoring.
