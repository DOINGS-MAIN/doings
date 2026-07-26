# Benzinga Loom Speaker Notes — Doings (Event Spark)

**Candidate:** Chukwuemeka Uzukwu  
**Project:** Doings (Event Spark)  
**Target length:** 8–12 minutes (hard stop at 15)  
**Repo:** `/Users/user/Documents/2026 Projects/DOINGS-MAIN/event-spark`

---

## Key reminder

**Say USDC, not USDT.** The crypto rail was migrated from USDT to USDC. The old `withdraw-usdt` edge function is gone. UI, types, and backend all say **USDC** (TRC-20 via Blockradar).

---

## Expected salary line

> **Expected salary: $50,000 USD annually (negotiable based on scope and benefits).**

Optional: **$52,000 to $55,000 USD annually**, open to discussion.

---

## Pre-recording checklist

### Environment
- [ ] Clean browser profile. No personal tabs or notifications.
- [ ] App running locally or staging with funded test account.
- [ ] VS Code open with tabs in order below.
- [ ] VS Code font size **14–16px**. Line numbers on.
- [ ] Terminal minimized.
- [ ] Loom: screen + webcam.
- [ ] Mic test done.

### Test account
- [ ] NGN + USDC balances visible.
- [ ] 2–3 transactions in history.
- [ ] KYC Level 2 (or demo gate screen).
- [ ] Admin account for transaction list / provider filter.
- [ ] Convert flow working (countdown visible).

### Recording
- [ ] Rehearse once without recording.
- [ ] 1–2 takes max. Trim dead air.
- [ ] Watch at 1.5x before sending.

---

## VS Code tabs (in order)

1. `src/pages/dashboard/HomePage.tsx`
2. `src/components/WalletCard.tsx`
3. `src/hooks/useMultiWallet.ts`
4. `src/lib/supabase.ts`
5. `src/hooks/useFxQuote.ts`
6. `src/components/ConvertSheet.tsx`
7. `src/components/WithdrawSheet.tsx`
8. `src/hooks/useAdminData.ts`
9. `src/pages/admin/AdminTransactions.tsx`
10. `supabase/functions/_shared/psp/registry.ts`
11. `supabase/functions/_shared/psp/platformSettings.ts`
12. `supabase/functions/_shared/psp/adapters/monnify.ts`
13. `supabase/functions/withdraw-ngn/index.ts`
14. `supabase/functions/fx-quote/index.ts`
15. `supabase/functions/fx-convert/index.ts`
16. `supabase/functions/withdraw-usdc/index.ts`

**Browser tabs:** Doings home → Admin Transactions

---

## Full script

### [0:00 – 0:45] Intro

**SCREEN:** Webcam then browser.

**SAY:** "Hi, I'm Chukwuemeka Uzukwu, a Senior Frontend Engineer based in Lagos. I'm excited about the Benzinga role because it sits right where I've been working: React, TypeScript, API driven products, dashboards, and fintech systems that need to be fast and reliable. Today I'll walk you through Doings, a fintech platform I built for live events and digital payments. I'll show the product, my role, the code behind the most important flows, and the biggest technical challenge I solved: building a multi provider payment system without breaking wallet correctness."

---

### [0:45 – 2:45] Product walkthrough

**SCREEN:** Browser.

| Time | Action | SAY |
|------|--------|-----|
| 0:45 | Home / wallet | "Doings lets users fund a wallet in NGN or USDC, spend at events, convert between currencies, and withdraw. Balances update in real time." |
| 1:30 | Fund | "Bank transfer via virtual accounts and USDC via Blockradar. KYC gates crypto." |
| 1:55 | Convert | "FX with locked quote countdown. Rates move so we lock before the user commits." |
| 2:15 | Withdraw | "Bank validation, fees, PIN, status tracking. UI matches backend state." |
| 2:35 | History | "Every action creates a ledger entry." |

---

### [2:45 – 3:30] Your role

**SAY:** "I was the lead frontend engineer. I owned wallet, funding, withdrawal, convert, history, and admin tooling. I worked with Supabase edge functions, helped design the payment provider abstraction, and made sure the frontend never lied about money. I ported multi PSP routing from Keyraso. What looks like a simple wallet sits on a complex payment and ledger system."

**TIP:** "Alright, let me pull up the actual code."

---

### [3:30 – 7:05] Code walkthrough

Use Cmd+G to jump to each line range.

#### HomePage → WalletCard (74–87)
**SAY:** "Home screen is thin. WalletCard is presentation only. Balances live in DashboardShellContext and useMultiWallet."

#### WalletCard balance (38–47)
**SAY:** "One card, two currencies. NGN whole numbers, USDC two decimals."

#### WalletCard toggle (77–98)
**SAY:** "Toggle drives primary balance and theme. Gold naira, teal USDC." **Say USDC, not USDT.**

#### WalletCard actions (169–218)
**SAY:** "Five actions. Convert is optional via onConvert prop."

#### useMultiWallet money math (14–18)
**SAY:** "Kobo and micro units. No floating point."

#### useMultiWallet PSP funding (85–91)
**SAY:** "No hardcoded Monnify. Platform picks active PSP."

#### useMultiWallet realtime (183–210)
**SAY:** "Postgres subscriptions on wallets and transactions. Visibility refresh on tab focus."

#### useMultiWallet stubs (249–264)
**SAY:** "Frontend never mutates balances. Webhooks and edge functions do."

#### supabase.ts APIs (203–227)
**SAY:** "fx-quote, fx-convert, withdraw-ngn, withdraw-usdc. USDC not USDT."

#### useFxQuote (43–72)
**SAY:** "Quote based FX. Countdown from expires_at. Auto refresh at zero."

#### ConvertSheet debounce (73–82)
**SAY:** "400ms debounce on quote requests."

#### ConvertSheet rate UI (227–277)
**SAY:** "Rate, fee, countdown. Amber under 10 seconds. Continue disabled at zero."

#### ConvertSheet execution (90–122)
**SAY:** "quote_id plus PIN only. QUOTE_EXPIRED refreshes quote. Fixed slow PIN entry edge case."

#### ConvertSheet KYC (124–143)
**SAY:** "Level 2 gate same as withdraw."

#### WithdrawSheet fees (65–74)
**SAY:** "NGN configurable fees. USDC flat $1. totalDeduction vs balance."

#### WithdrawSheet confirm (151–181)
**SAY:** "One handler, two rails. PIN errors return to confirm."

#### WithdrawSheet fee UI (288–323)
**SAY:** "Itemized fees before confirm."

#### useAdminData mapTransaction (33–66)
**SAY:** "Smallest units in, display out. Infer fees from metadata when column is zero."

#### useAdminData live (241–257)
**SAY:** "Admin feed updates on every transaction change."

#### AdminTransactions filters (93–103)
**SAY:** "Server side filters. 300ms debounced search."

#### AdminTransactions providers (266–278)
**SAY:** "Monnify, Nomba, Flutterwave, Blockradar, internal."

#### AdminTransactions RBAC (384–415)
**SAY:** "Flag and refund permission gated."

**TIP:** Quick browser cut to admin provider filter if you have 5 seconds.

---

### [7:05 – 8:45] Technical challenge

#### Problem setup
**SAY:** "Multiple PSPs, different APIs and webhooks. One withdrawal pipeline plus separate USDC rail."

#### psp/registry.ts (16–48)
**SAY:** "Adapter registry. Monnify, Nomba, Flutterwave. No forking withdraw per provider."

#### platformSettings.ts (10–27)
**SAY:** "platform_settings row 1. Admin switches rails without redeploy."

#### monnify adapter (40–72)
**SAY:** "Same interface. Statuses normalized to accepted, rejected_terminal, non_terminal."

#### withdraw-ngn lock (79–120)
**SAY:** "lock_withdrawal before any PSP call. Fail fast on insufficient balance."

#### withdraw-ngn PSP dance (122–207)
**SAY:** "Log request, submitTransfer, log response. fail_withdrawal on terminal reject. psp_events audit trail."

#### supabase pspEvents (337–341)
**SAY:** "Admin lists and exports PSP events."

#### fx-quote (11–36)
**SAY:** "Binance USDC/NGN. 5 minute staleness. Server mints quotes."

#### fx-convert (36–58)
**SAY:** "execute_fx_swap with quote_id only. Atomic debit and credit."

#### withdraw-usdc (47–75)
**SAY:** "USDC migration. micro units. Blockradar TRC-20. withdraw-usdt gone."

#### supabase invoke (14–32, 34–79)
**SAY:** "JWT refresh. Structured error codes to UI. QUOTE_EXPIRED, PIN_NOT_SET."

#### Wrap-up
**SAY:** "Adapter registry, runtime rail switching, lock then disburse, quote locked FX, realtime honesty. Bug fix: wrong bank fields and double amount conversion. Pattern from Keyraso into Doings. Also Krownpay and Mentorfy, but Doings shows real time fintech UX best."

---

### [9:00 – 9:45] Close

**SCREEN:** Webcam.

**SAY:** "That is Doings. I enjoy making complex systems understandable and trustworthy. I would love to bring that to Benzinga on data driven and real time financial products. Thank you for watching."

---

## Email template

**Subject:** Frontend Developer Application – Chukwuemeka Uzukwu

> Hi [Name],
>
> I am interested in the Frontend Developer role with Benzinga. Please find my CV attached.
>
> **Expected salary:** $50,000 USD annually (negotiable).
>
> **Loom walkthrough:** [link]
>
> The video covers Doings, a fintech platform I led frontend development on, including wallet flows, admin transaction tooling, and the multi provider payment challenge I solved.
>
> Happy to discuss further.
>
> Best,  
> Chukwuemeka Uzukwu  
> cdavia66@gmail.com  
> +234 703 424 8173

---

## If running long — cut in this order

1. Convert browser demo (keep code)
2. Admin browser cutaway (keep code)
3. Krownpay / Mentorfy mention
4. Monnify adapter deep dive (keep registry + withdraw-ngn)

**Never cut:** Intro, your role, multi-PSP story, close.

---

## Line reference (verified Jul 13, 2026)

| File | Lines | Topic |
|------|-------|-------|
| HomePage.tsx | 74–87 | WalletCard wiring |
| WalletCard.tsx | 38–47, 77–98, 169–218 | Balance, toggle, actions |
| useMultiWallet.ts | 14–18, 85–91, 183–210, 249–264 | Money, PSP, realtime, stubs |
| supabase.ts | 14–32, 34–79, 203–227, 337–341 | Auth, APIs, PSP events |
| useFxQuote.ts | 43–72 | Quote TTL |
| ConvertSheet.tsx | 73–82, 90–122, 124–143, 227–277 | Debounce, execute, KYC, UI |
| WithdrawSheet.tsx | 65–74, 151–181, 288–323 | Fees, confirm, breakdown |
| useAdminData.ts | 33–66, 241–257 | Normalize, live feed |
| AdminTransactions.tsx | 93–103, 266–278, 384–415 | Filters, providers, RBAC |
| psp/registry.ts | 16–48 | Adapters |
| platformSettings.ts | 10–27 | Runtime PSP |
| monnify.ts | 40–72 | Transfer outcomes |
| withdraw-ngn/index.ts | 79–120, 122–207 | Lock, disburse, audit |
| fx-quote/index.ts | 11–36 | Binance cache |
| fx-convert/index.ts | 36–58 | Atomic swap |
| withdraw-usdc/index.ts | 47–75 | USDC rail |

**Avoid on camera:** leveraged, spearheaded, robust, seamless, cutting edge  
**Use instead:** "I built", "I fixed", "I traced", "we locked funds first"
