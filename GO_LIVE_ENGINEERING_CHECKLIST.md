# Pre-launch engineering checklist — Event Spark

**Audience:** Engineering  
**Use:** Track module-by-module tightening before production. Check items off as you go; add owners/dates in your tracker if helpful.

Related: `FOUNDERS_GO_LIVE_BRIEF.md` (stakeholder summary), `supabase/LIVE_DEPLOY_AND_INTEGRATION_TEST.md` (backend integration).

---

## 1. Platform, build & env

- [ ] `VITE_SUPABASE_URL` and `VITE_SUPABASE_ANON_KEY` set **at build time** for every deploy (Vite inlines them).
- [ ] Production vs staging URLs documented; no production keys in repo.
- [ ] `npm run build` and `npm run lint` clean on `main` (or release branch).
- [ ] CI workflow runs at least `lint` + `build` on PR (add if missing).
- [ ] Error boundary or global handler for unexpected render errors (optional but recommended).
- [ ] `serve` / hosting: SPA fallback configured so deep links (`/events/...`) resolve.

---

## 2. Auth & session (`AuthFlow`, `useAuth`, `LoginPage`, `RequireAuth`)

- [ ] Sign-up, sign-in, sign-out happy paths verified against live Supabase Auth.
- [ ] Google OAuth (if enabled): redirect URLs correct for prod domain.
- [ ] Session refresh behaviour sane for long sessions (`lib/supabase.ts` `authHeaders` refresh path).
- [ ] `useAuth` profile load failures: user-visible messaging or retry, not silent broken state.
- [ ] Post-login redirect (`RootRedirect`, protected routes) covers all entry points.

---

## 3. Wallet, balances & history (`useMultiWallet`, `WalletCard`, `TransactionHistory`)

- [ ] Initial load and Realtime updates verified when `wallets` / `transactions` change.
- [ ] Amount display: consistent **kobo ↔ naira** (and micro-USDT ↔ USDT) everywhere.
- [ ] `creditWallet` / `debitWallet` stubs: confirm no code path relies on them for correctness (they are no-ops by design).
- [ ] Transaction list: handles empty, loading, and long lists (performance / scroll).
- [ ] Locked balance surfaced in UI if product requires it during pending withdrawals.
- [ ] **Available balance** (spendable / withdrawable) defined and shown if you use `locked_balance` or pending debits — do not rely on raw `balance` alone in UX when holds exist.

---

## 4. Funding — NGN (`FundWalletSheet`, `create-monnify-account`, webhooks)

- [ ] Reserved account creation + display matches DB / Monnify.
- [ ] Bank transfer UX: copy actions, no **simulated** credit; messaging matches webhook-driven credits.
- [ ] Remove or gate **card** flow until a real integration exists (currently UI-only with test-style defaults).
- [ ] `handleFundNGN` / `handleFundUSDT` in `DashboardLayout`: align with actual funding mechanics (toast-only is misleading if users expect instant confirmation).
- [ ] KYC gates (`KYC_GATES`) match product for NGN funding.

---

## 5. Funding — USDT (`FundWalletSheet`, `create-blockradar-address`, webhooks)

- [ ] Address creation per network; reuse existing address when present.
- [ ] Wrong-network / token warnings reviewed for clarity.
- [ ] KYC gates for USDT receive path verified.

---

## 6. Withdrawals (`WithdrawSheet`, `useMultiWallet`, `withdraw-ngn`, `withdraw-usdt`)

- [ ] **Contract alignment:** `withdraw-ngn` expects amount in **naira** (server multiplies by 100). Client must send naira, not kobo — verify `useMultiWallet` / `lib/supabase` call chain.
- [ ] Pass real **`bank_code`** and **`account_name`** (account holder), not placeholders or bank brand as name.
- [ ] `WithdrawSheet`: **`await`** withdrawal; remove artificial delay; map API errors to user messages; only show success after confirmed response (or document “pending” if async).
- [ ] UI fee model (e.g. %) vs server **flat fee** in edge function — reconcile copy and totals.
- [ ] Minimum withdrawal: UI vs `withdraw-ngn` validation aligned.
- [ ] USDT: network selection, address validation, failure paths; KYC gate matches policy (`WithdrawSheet` currently gates at L3 — confirm vs backend).
- [ ] PIN step: verify server-side enforcement or adjust UX.
- [ ] **Mandatory:** full **§21** (ledger integrity, races, idempotency) signed off before prod — no reliance on Monnify VA “balance” to block withdrawals; VA is **inbound collection**, not the app ledger.

---

## 7. Transfers / Send money (`SendMoneySheet`, `transfer` function)

- [ ] **Recipient search:** replace mock delay + fabricated “found user” with real lookup (phone / username per `transfer` API).
- [ ] **Recent recipients:** replace hardcoded list with real data or remove until available.
- [ ] Confirm `transfers.send` amount unit (kobo) matches API expectations end-to-end.
- [ ] Deriving `recipientPhone` from `@username` — confirm backend resolves usernames or restrict UI to phone until supported.
- [ ] Remove unnecessary artificial delay in search unless needed for UX debounce.

---

## 8. Bank accounts (`BankAccountsSheet`, `useBankAccounts`, `verify-bank-account`)

- [ ] Add / verify / list / default flows work against `bank_accounts` + Monnify verify.
- [ ] Bank picker list (`NIGERIAN_BANKS`) kept current or sourced from API if Monnify provides list.
- [ ] Saved `bank_code` flows through to withdrawal (see §6).

---

## 9. KYC (`KYCVerificationSheet`, `useKYC`, `kyc-dojah-verify`)

- [ ] Level 1: UI matches real process (OTP / profile) — avoid steps that do not hit the server.
- [ ] Level 2: BVN + DOB → Dojah; errors surfaced clearly.
- [ ] Level 3: replace **`mock-base64-selfie`** with real camera/file → base64 (or presigned upload per Dojah requirements).
- [ ] Selfie “simulate” button: dev-only or removed for prod builds.
- [ ] `users.kyc_level` and gates (`KYC_GATES`) consistent across app after each tier.

---

## 10. Events & spray (`useEvents`, `CreateEventSheet`, `EventDetailsSheet`, `JoinEventSheet`, `SpraySetupSheet`, `SprayAnimation`, `spray` function)

- [ ] Create / update / go-live / end / delete / join — all exercised against live `events` edge function.
- [ ] Event codes: uniqueness, share copy, join-by-code.
- [ ] Spray: denominations, amounts, insufficient balance, idempotency / double-submit prevention.
- [ ] `DashboardLayout` spray complete/cancel: error handling and ledger correctness.
- [ ] `MyEventsScreen` / lists: loading states, empty states, totals (e.g. sprayed amounts) match backend units.

---

## 11. Event screen / projector (`EventScreenPage`, `EventScreenView`)

- [ ] Replace **mock spray activity** + interval with Realtime/poll on real spray data for that `eventId`, or hide feed for v1.
- [ ] Fullscreen / QR behaviour smoke-tested on target devices/browsers.
- [ ] Giveaways shown: filter logic matches `eventId` + `showOnEventScreen`.

---

## 12. Giveaways (`useGiveaways`, `CreateGiveawaySheet`, `RedeemGiveawaySheet`, `GiveawayDetailsSheet`, `GiftsScreen`)

- [ ] Create (debit / lock pool), redeem, stop/refund — full matrix on staging.
- [ ] Codes, privacy flags, linkage to live events where required.
- [ ] `GiftsScreen` aggregates (totals, redemptions) match API field meanings.

---

## 13. Leaderboard (`useLeaderboard`, `LeaderboardScreen`, materialized views)

- [ ] Views `leaderboard_weekly` / `monthly` / `alltime` exist and refresh job (`cron-leaderboard`) runs in prod.
- [ ] Empty leaderboard and permission errors handled.
- [ ] Units (kobo → display) consistent with §3.

---

## 14. Notifications (`useNotifications`, `NotificationsScreen`)

- [ ] List, unread filter, mark read / mark all read against `notifications` function.
- [ ] Embedded vs full-screen modes (`DashboardLayout`) both OK.
- [ ] Triggers from DB verified in staging (deposits, sprays, KYC, giveaways per migrations).

---

## 15. Profile & avatar (`ProfileScreen`, `AvatarCustomization`)

- [ ] Profile fields persist (`useAuth` / `users` updates).
- [ ] “Coming soon” rows: either ship minimal real pages (Security, Help, Terms, Rate) or copy that sets expectations pre-launch.
- [ ] AI avatar: clearly non-blocking for launch; remove misleading CTA if needed.

---

## 16. Home & navigation (`HomePage`, `BottomNav`, `DashboardShellContext`)

- [ ] All nav targets work; shell context provides everything child routes need without stale closures.
- [ ] Fund / history / notifications entry points tested.

---

## 17. Admin (`AdminLayout`, `useAdminAuth`, `useAdminData`, admin pages)

- [ ] Admin login, session, role checks against `admin` edge function + `admin_roles`.
- [ ] Users, transactions, KYC, events, audit, team flows smoke-tested with least-privilege accounts.
- [ ] Sensitive actions logged; error states and pagination verified.
- [ ] Admin routes not linked from public app in a way that aids discovery (optional hardening).

---

## 18. Supabase backend (cross-cutting)

- [ ] All migrations applied; RLS policies sanity-checked for new tables.
- [ ] Edge functions deployed; secrets set; CORS if applicable.
- [ ] Monnify + Blockradar webhooks: URLs, signatures, idempotency; `webhook_logs` clean on happy path.
- [ ] Cron: leaderboard + reconciliation; `CRON_SECRET` rotated and stored safely.
- [ ] Auth signup hook: `public.users` + wallets created for new signups.
- [ ] Rate limits and anomaly flags understood; admin workflow for `transaction_flags`.
- [ ] **§21** ledger / idempotency / concurrency checks exercised against staging (not only happy path).

---

## 19. Security & compliance (app + backend)

- [ ] No secrets or provider keys in client bundle.
- [ ] Content Security Policy / headers if platform supports them.
- [ ] PIN/password copy matches actual enforcement.
- [ ] Dependency audit (`npm audit`) — address critical issues or document acceptance.

---

## 20. Cleanup & debt (non-blocking but worth scheduling)

- [ ] `hooks/useWallet.ts`: confirm unused or remove to avoid confusion with `useMultiWallet`.
- [ ] `types/finance.ts` comment “mocked” on provider types — update if misleading.
- [ ] `supabase/seed.sql` placeholder: replace if local/staging needs realistic seeds.

---

## 21. Ledger integrity, debits & concurrency (**MUST — pre-prod, no loopholes**)

**Principle:** Authorization and sufficiency of funds happen **only** on the server against the **authoritative ledger** (and any `locked_balance` / pending states). The UI, Monnify **virtual accounts**, and cached client balances are **not** sources of truth for whether a debit may proceed.

- [ ] **Inbound vs outbound:** Document for the team: customer **VAs fund in** (webhook → `credit_wallet`); **withdrawals / transfers / spray / giveaways** debit **your** `wallets` ledger. Monnify does **not** replace server-side “can this user still withdraw?” checks.
- [ ] **Atomic debits:** Every debit path (`debit_wallet`, withdrawal, transfer, spray, giveaway fund, etc.) uses a **single transaction** (or RPC) that checks **available** funds and applies the debit so two concurrent requests cannot both succeed.
- [ ] **Row-level safety:** Wallet (or user) rows updated with appropriate locking / isolation so parallel edge invocations cannot double-spend (verify Postgres function + transaction boundaries).
- [ ] **Idempotency:** All money-moving edge actions accept **idempotency keys** (or equivalent) end-to-end; retries and double-clicks do not create duplicate debits or payouts.
- [ ] **Pending / locked funds:** If a withdrawal (or similar) is async or pending, funds are **reserved** (`locked_balance` or equivalent) until terminal state; UI shows **available** balance; stale “total balance” cannot encourage a second full withdrawal.
- [ ] **Client UX guardrails:** Disable submit while in flight; refetch wallet after success/failure; no success toast until server confirms (or explicit “pending” state).
- [ ] **Tests / manual matrix (staging):**
  - [ ] Double-submit / rapid double-click on withdraw and other debits.
  - [ ] Two parallel API calls (same user, same operation) with tools like `curl` or a script.
  - [ ] Withdraw → before UI refreshes, attempt second withdraw (should fail or queue cleanly).
  - [ ] Insufficient balance, exact boundary amount, and balance after fee.
  - [ ] Webhook / credit ordering vs pending debit (no negative or inconsistent ledger).
- [ ] **Reconciliation:** Periodic or admin process to detect ledger drift, duplicate provider refs, and stuck pending states.
- [ ] **Sign-off:** Owner attests §21 matrix run and any gaps either fixed or explicitly risk-accepted in writing.

---

## Sign-off

| Area | Owner | Ready (Y/N) | Notes |
|------|--------|-------------|-------|
| Platform / CI | | | |
| Money paths | | | |
| KYC | | | |
| Events / spray | | | |
| Admin / ops | | | |

---

*Last updated: align with repo as of checklist creation; extend modules as new surfaces ship.*
