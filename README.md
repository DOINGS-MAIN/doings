# Doings — Spray the Vibe

Digital money spraying platform for Nigerian events. Fund your wallet, spray at live events, create giveaways, and withdraw to your bank.

## Tech Stack

- **Frontend**: React, TypeScript, Vite, Tailwind CSS, shadcn/ui
- **Backend**: Supabase (PostgreSQL, Edge Functions, Auth, Realtime)
- **Payments**: Monnify (NGN), Blockradar (USDT), Dojah (KYC)

## Local Development

```bash
npm install
npm run dev
```

## Environment Variables

Create a `.env` file:

```env
VITE_SUPABASE_URL=https://<project-ref>.supabase.co
VITE_SUPABASE_ANON_KEY=<anon-key>
```

## Supabase Backend

See `supabase/EXECUTION_PLAN.md` for full backend architecture and `supabase/LIVE_DEPLOY_AND_INTEGRATION_TEST.md` for deployment steps.
