# Go-Live Readiness Brief — Doings (Event Spark)

**Audience:** Founders  
**From:** Engineering / Tech Lead  
**Purpose:** A clear picture of what remains before we can ship to production with confidence, and how we propose to use the next two weeks.

This note is meant to align expectations, not to assign blame. Building a fintech-style product means the backend, providers, and client often move in parallel. The **Supabase side is well documented and largely feature-complete** per our execution plan; what follows is the **integration, verification, and polish pass** that every team runs before exposing real money to users.

---

## Where we are today

- **Backend (Supabase):** Migrations, edge functions, admin APIs, webhooks, and operational jobs are specified and implemented in-repo, with a published deploy and integration checklist.
- **Web app:** Core screens and flows are in place and connected to Supabase in many areas (auth patterns, events, sprays, giveaways, wallet reads, etc.).
- **Gaps:** Some user journeys still use **staging-style behaviour** on the client (e.g. simplified confirmations or placeholders) that need to be **replaced or aligned** with live provider behaviour before launch. This is normal for an MVP sprint; it is exactly the kind of work we schedule in a pre-release hardening window.

---

## Two-week roadmap (high level)

| Week | Focus |
|------|--------|
| **Week 1** | Production backend setup, secrets, webhooks, and **closing the loop** on money paths so the app matches what Monnify, Blockradar, and our edge functions actually do. |
| **Week 2** | End-to-end QA, security and compliance checks, minimal automation (build/CI), legal/support surfaces, and launch rehearsal. |

### Proposed timeline (14 working days)

Calendar dates can be dropped in once we agree the sprint start; the **sequence** is what matters for dependencies.

| Phase | Days | Outcomes |
|--------|------|----------|
| **Environment & backend live** | 1–3 | Staging Supabase linked, migrations applied, functions deployed, secrets and webhook URLs set; first full pass on the integration checklist in **staging**. |
| **Money-path alignment** | 2–6 | Funding and withdrawal flows match production contracts; card path integrated or scoped out; fees/limits aligned with backend. |
| **Identity & surfaces** | 4–7 | KYC flows use real inputs where required; event “big screen” uses live data or is explicitly deferred for v1. |
| **QA & regression** | 8–11 | Full manual test matrix on staging; fixes for anything that blocks real-money confidence. |
| **Hardening & gates** | 10–12 | CI (lint + build); security/compliance checklist; help/terms/privacy or honest placeholders. |
| **Production & launch** | 12–14 | Production deploy (or promote), final smoke, monitoring and rollback plan; go-live window. |

*Days overlap on purpose (e.g. QA can start while minor alignment work finishes) so we are not idle waiting on a single stream.*

---

## Week 1 — Backend live + client alignment

### 1. Live Supabase environment

- Apply migrations, deploy edge functions, configure provider secrets, webhook URLs, and scheduled jobs (leaderboard refresh, reconciliation) per our existing runbook.
- Run the documented integration scenarios on a **staging** project first, then promote to production when stable.

### 2. Funding (NGN / USDT)

- **Bank transfer (NGN):** Ensure the experience matches reality: users fund via their reserved account and **credits arrive via webhook** — any client messaging or confirmation steps should reflect that, not imply instant local balance changes unless we implement a dedicated status check.
- **Card (NGN):** The UI includes a card path that is **not yet wired** to a live card product. Before go-live we should either **integrate** with the chosen provider or **temporarily scope out** that path so users only see options we fully support.
- **USDT:** Deposit address generation and user guidance should match Blockradar behaviour we validate in staging.

### 3. Withdrawals (NGN)

- The server contract expects specific fields (amount in the unit the API defines, bank code, account number, **account holder name**). We need a **quick alignment pass** between the withdrawal UI, bank-account data, and the edge function so every field maps correctly end-to-end.
- The confirmation UX should **await** the server response and surface failures clearly, consistent with other financial actions.

### 4. KYC

- Higher verification tiers should use **real inputs** end-to-end (including identity steps that rely on image capture), matching what Dojah and our `kyc-dojah-verify` function expect.
- Level-one flows should match how we actually establish identity today (e.g. auth and profile), so users are not asked for steps we do not perform.

### 5. Event display / “big screen” experience

- Any **demo or illustrative** activity feed should be replaced with **live data** (or clearly deferred for v1) so public or host-facing views reflect real sprays.

### 6. Fees and limits

- Reconcile displayed fees and minimums with what `withdraw-ngn`, `lock_withdrawal`, and product policy specify, so users never see numbers we cannot honour.

---

## Week 2 — QA, hardening, launch

### Testing checklist (representative)

We will walk through, at minimum:

- Auth (sign-up, sign-in, session lifecycle, sign-out)
- Wallet balances and updates after deposits, sprays, transfers, withdrawals
- NGN funding via reserved account + webhook
- USDT deposits
- KYC gates vs product rules (fund, withdraw, etc.)
- Events: create, go live, join, spray, ledger correctness
- Giveaways: create, redeem, stop / refund behaviour
- P2P transfers
- Withdrawals (NGN and USDT) including failure paths
- Notifications
- Admin console and audit trail
- Rate limits and anomaly flags (large or rapid activity)
- Cron / scheduled jobs

### Engineering hygiene

- Add **CI** that runs `lint` and `build` on each change (we do not rely on this yet today).
- Optionally add a **short automated smoke** test later; the first gate is thorough manual integration testing on staging and production-like data.

### Security and compliance

- Webhook signature verification, secrets only in managed stores, review of flagged transactions, and confirmation that admin actions are audited — aligned with our go-live safety list.

### Product and legal

- Replace **“coming soon”** entries where users expect real content (e.g. help, terms, privacy) with either live pages or accurate copy that sets expectations.
- Confirm **PIN or step-up** behaviour matches what the backend enforces, or adjust the UI until it does.

### Launch day

- Final smoke on production URLs, monitoring on webhooks and logs, and a clear rollback / comms plan.

---

## What we are *not* claiming is blocking MVP

Items we can treat as **post-launch** unless leadership explicitly pulls them in:

- Optional providers marked dormant in our docs (e.g. alternate USDT rails)
- Nice-to-have profile features (e.g. certain settings tiles that are intentionally future work)
- AI avatar or other engagement features labelled as future in the product

---

## Closing

The team has built a **substantial backend and a rich client** in a short time. What remains is the **predictable final mile**: wire a few flows to production truth, remove ambiguity in funding and withdrawal UX, run the integration matrix, and put standard launch guardrails in place. With **two focused weeks**, we can reach a **founder- and regulator-defensible** first production release, with scope explicitly documented where we defer features.

If you would like, we can attach owners and dates to each bullet in this brief in the project tracker for the sprint.
