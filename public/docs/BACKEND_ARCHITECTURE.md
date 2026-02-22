# Doings App — Backend Architecture & Implementation Guide

> **Version:** 1.0  
> **Date:** February 2026  
> **Audience:** Backend Engineers, DevOps, Security Team  
> **Frontend Stack:** React + Vite + TypeScript (hosted on Lovable)

---

## Table of Contents

1. [System Overview](#1-system-overview)
2. [Database Schema](#2-database-schema)
3. [Authentication & Authorization](#3-authentication--authorization)
4. [KYC System (Dojah Integration)](#4-kyc-system-dojah-integration)
5. [Wallet & Ledger System](#5-wallet--ledger-system)
6. [Financial Provider Integrations](#6-financial-provider-integrations)
7. [Events System](#7-events-system)
8. [Giveaways System](#8-giveaways-system)
9. [Leaderboard System](#9-leaderboard-system)
10. [Admin System](#10-admin-system)
11. [API Endpoints](#11-api-endpoints)
12. [Webhooks](#12-webhooks)
13. [Security & Vulnerability Measures](#13-security--vulnerability-measures)
14. [DevOps & Infrastructure](#14-devops--infrastructure)
15. [Appendix: Environment Variables](#15-appendix-environment-variables)

---

## 1. System Overview

**Doings** is a Nigerian fintech/social platform where users "spray" (gift) money at events digitally. It supports:

- **Phone-based auth** with OTP (Nigerian +234 format)
- **Multi-currency wallets** (NGN + USDT)
- **Tiered KYC** (3 levels via Dojah)
- **Event hosting** with real-time spraying
- **Giveaways** with redemption codes
- **Leaderboards** ranking top gifters
- **Admin panel** with role-based access

### Architecture Pattern

```
┌──────────────┐     ┌──────────────────┐     ┌─────────────────────┐
│   Frontend   │────▶│  API Gateway /   │────▶│   External APIs     │
│  (React SPA) │     │  Edge Functions   │     │  Monnify, Dojah,    │
│              │◀────│  (Supabase/Node)  │◀────│  Blockradar, Quidax │
└──────────────┘     └───────┬──────────┘     └─────────────────────┘
                             │
                    ┌────────▼────────┐
                    │   PostgreSQL    │
                    │   (Supabase)    │
                    │  + Redis Cache  │
                    └─────────────────┘
```

### Core Principles

- **Double-entry ledger** for all financial operations
- **Idempotency keys** on every monetary transaction
- **KYC gates** enforced server-side (never trust the client)
- **Webhook signature verification** for all providers
- **All provider API keys server-side only** — never exposed to frontend

---

## 2. Database Schema

### 2.1 Users

```sql
CREATE TABLE public.users (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  phone VARCHAR(15) NOT NULL UNIQUE, -- Nigerian format: +234XXXXXXXXXX
  email VARCHAR(255),
  full_name VARCHAR(200),
  username VARCHAR(50) UNIQUE,
  avatar_url TEXT,
  avatar_data JSONB, -- { outfit, accessory, background }
  kyc_level SMALLINT NOT NULL DEFAULT 0 CHECK (kyc_level BETWEEN 0 AND 3),
  status VARCHAR(20) NOT NULL DEFAULT 'active' CHECK (status IN ('active', 'suspended', 'banned')),
  suspended_reason TEXT,
  date_of_birth DATE,
  address TEXT,
  referral_code VARCHAR(10) UNIQUE,
  referred_by UUID REFERENCES public.users(id),
  last_active_at TIMESTAMPTZ,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE INDEX idx_users_phone ON public.users(phone);
CREATE INDEX idx_users_username ON public.users(username);
CREATE INDEX idx_users_status ON public.users(status);
CREATE INDEX idx_users_kyc_level ON public.users(kyc_level);
```

### 2.2 Admin Roles (Separate Table — CRITICAL)

```sql
CREATE TYPE public.admin_role AS ENUM (
  'super_admin', 'finance', 'support', 'compliance', 'moderation'
);

CREATE TABLE public.admin_roles (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id UUID NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE,
  role admin_role NOT NULL,
  invited_by UUID REFERENCES auth.users(id),
  status VARCHAR(20) NOT NULL DEFAULT 'active' CHECK (status IN ('active', 'invited', 'disabled')),
  must_change_password BOOLEAN DEFAULT false,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  UNIQUE (user_id, role)
);

-- SECURITY DEFINER function to check roles (prevents RLS recursion)
CREATE OR REPLACE FUNCTION public.has_admin_role(_user_id UUID, _role admin_role)
RETURNS BOOLEAN
LANGUAGE sql STABLE SECURITY DEFINER
SET search_path = public
AS $$
  SELECT EXISTS (
    SELECT 1 FROM public.admin_roles
    WHERE user_id = _user_id AND role = _role AND status = 'active'
  )
$$;

CREATE OR REPLACE FUNCTION public.is_any_admin(_user_id UUID)
RETURNS BOOLEAN
LANGUAGE sql STABLE SECURITY DEFINER
SET search_path = public
AS $$
  SELECT EXISTS (
    SELECT 1 FROM public.admin_roles
    WHERE user_id = _user_id AND status = 'active'
  )
$$;
```

### 2.3 KYC Verifications

```sql
CREATE TABLE public.kyc_verifications (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id UUID NOT NULL REFERENCES public.users(id) ON DELETE CASCADE,
  level SMALLINT NOT NULL CHECK (level BETWEEN 1 AND 3),
  status VARCHAR(20) NOT NULL DEFAULT 'pending' CHECK (status IN ('pending', 'verified', 'rejected')),
  provider VARCHAR(20) NOT NULL DEFAULT 'dojah',
  provider_ref VARCHAR(100),
  
  -- Level 2 data (BVN)
  bvn_hash VARCHAR(64), -- SHA-256 hash, never store raw BVN
  bvn_last_four VARCHAR(4),
  bvn_first_name VARCHAR(100),
  bvn_last_name VARCHAR(100),
  bvn_phone VARCHAR(15),
  bvn_dob DATE,
  
  -- Level 3 data (NIN + Selfie)
  nin_hash VARCHAR(64), -- SHA-256 hash
  nin_last_four VARCHAR(4),
  selfie_match_confidence DECIMAL(5,2),
  selfie_image_ref VARCHAR(255), -- Reference in secure storage, not raw image
  
  -- Admin review
  reviewed_by UUID REFERENCES auth.users(id),
  reviewed_at TIMESTAMPTZ,
  rejection_reason TEXT,
  
  submitted_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  verified_at TIMESTAMPTZ,
  raw_response JSONB, -- Encrypted Dojah response for audit
  
  created_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE INDEX idx_kyc_user ON public.kyc_verifications(user_id);
CREATE INDEX idx_kyc_status ON public.kyc_verifications(status);
CREATE INDEX idx_kyc_level ON public.kyc_verifications(level);
```

### 2.4 Wallets

```sql
CREATE TYPE public.currency AS ENUM ('NGN', 'USDT');

CREATE TABLE public.wallets (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id UUID NOT NULL REFERENCES public.users(id) ON DELETE CASCADE,
  currency currency NOT NULL,
  balance BIGINT NOT NULL DEFAULT 0, -- Store in smallest unit (kobo for NGN, 6 decimals for USDT)
  locked_balance BIGINT NOT NULL DEFAULT 0,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  UNIQUE (user_id, currency),
  CONSTRAINT positive_balance CHECK (balance >= 0),
  CONSTRAINT positive_locked CHECK (locked_balance >= 0),
  CONSTRAINT locked_within_balance CHECK (locked_balance <= balance)
);

CREATE INDEX idx_wallets_user ON public.wallets(user_id);
```

### 2.5 Wallet Addresses (Provider-generated)

```sql
CREATE TABLE public.wallet_addresses (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  wallet_id UUID NOT NULL REFERENCES public.wallets(id) ON DELETE CASCADE,
  provider VARCHAR(20) NOT NULL CHECK (provider IN ('monnify', 'blockradar', 'quidax')),
  address VARCHAR(255) NOT NULL,
  label VARCHAR(100),
  network VARCHAR(20), -- 'TRC20', 'BEP20', 'ERC20'
  metadata JSONB,
  status VARCHAR(20) NOT NULL DEFAULT 'active' CHECK (status IN ('active', 'inactive')),
  created_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE INDEX idx_wallet_addr_wallet ON public.wallet_addresses(wallet_id);
CREATE INDEX idx_wallet_addr_provider ON public.wallet_addresses(provider);
```

### 2.6 Transactions

```sql
CREATE TYPE public.transaction_type AS ENUM (
  'deposit', 'withdrawal', 'send', 'receive', 'spray', 'giveaway', 'giveaway_refund', 'swap'
);

CREATE TYPE public.transaction_status AS ENUM (
  'pending', 'processing', 'completed', 'failed', 'refunded'
);

CREATE TABLE public.transactions (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  wallet_id UUID NOT NULL REFERENCES public.wallets(id),
  user_id UUID NOT NULL REFERENCES public.users(id),
  currency currency NOT NULL,
  type transaction_type NOT NULL,
  amount BIGINT NOT NULL, -- Positive = credit, Negative = debit (in smallest unit)
  fee BIGINT NOT NULL DEFAULT 0,
  net_amount BIGINT NOT NULL,
  status transaction_status NOT NULL DEFAULT 'pending',
  
  -- Provider info
  provider VARCHAR(20) CHECK (provider IN ('monnify', 'blockradar', 'quidax', 'internal')),
  provider_ref VARCHAR(255),
  
  -- Idempotency
  idempotency_key VARCHAR(255) NOT NULL UNIQUE,
  
  -- Context
  description TEXT NOT NULL,
  metadata JSONB, -- { toAddress, network, bankName, accountNumber, eventId, etc. }
  
  -- Flags
  flagged BOOLEAN DEFAULT false,
  flag_reason TEXT,
  
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  completed_at TIMESTAMPTZ,
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE INDEX idx_txn_wallet ON public.transactions(wallet_id);
CREATE INDEX idx_txn_user ON public.transactions(user_id);
CREATE INDEX idx_txn_status ON public.transactions(status);
CREATE INDEX idx_txn_type ON public.transactions(type);
CREATE INDEX idx_txn_idempotency ON public.transactions(idempotency_key);
CREATE INDEX idx_txn_created ON public.transactions(created_at DESC);
CREATE INDEX idx_txn_flagged ON public.transactions(flagged) WHERE flagged = true;
```

### 2.7 Ledger Entries (Double-Entry)

```sql
CREATE TABLE public.ledger_entries (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  transaction_id UUID NOT NULL REFERENCES public.transactions(id),
  wallet_id UUID NOT NULL REFERENCES public.wallets(id),
  entry_type VARCHAR(10) NOT NULL CHECK (entry_type IN ('debit', 'credit')),
  amount BIGINT NOT NULL CHECK (amount > 0),
  balance_before BIGINT NOT NULL,
  balance_after BIGINT NOT NULL,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE INDEX idx_ledger_txn ON public.ledger_entries(transaction_id);
CREATE INDEX idx_ledger_wallet ON public.ledger_entries(wallet_id);
```

### 2.8 Internal Transfers

```sql
CREATE TABLE public.transfers (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  sender_wallet_id UUID NOT NULL REFERENCES public.wallets(id),
  receiver_wallet_id UUID NOT NULL REFERENCES public.wallets(id),
  sender_user_id UUID NOT NULL REFERENCES public.users(id),
  receiver_user_id UUID NOT NULL REFERENCES public.users(id),
  currency currency NOT NULL,
  amount BIGINT NOT NULL CHECK (amount > 0),
  fee BIGINT NOT NULL DEFAULT 0,
  status transaction_status NOT NULL DEFAULT 'completed',
  
  -- Links to the two transaction records (sender debit + receiver credit)
  sender_transaction_id UUID REFERENCES public.transactions(id),
  receiver_transaction_id UUID REFERENCES public.transactions(id),
  
  description TEXT,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE INDEX idx_transfers_sender ON public.transfers(sender_user_id);
CREATE INDEX idx_transfers_receiver ON public.transfers(receiver_user_id);
```

### 2.9 Bank Accounts

```sql
CREATE TABLE public.bank_accounts (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id UUID NOT NULL REFERENCES public.users(id) ON DELETE CASCADE,
  bank_code VARCHAR(10) NOT NULL,
  bank_name VARCHAR(100) NOT NULL,
  account_number VARCHAR(10) NOT NULL,
  account_name VARCHAR(200) NOT NULL,
  is_default BOOLEAN DEFAULT false,
  is_verified BOOLEAN DEFAULT false,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE INDEX idx_bank_user ON public.bank_accounts(user_id);
-- Ensure only one default per user
CREATE UNIQUE INDEX idx_bank_default ON public.bank_accounts(user_id) WHERE is_default = true;
```

### 2.10 Events

```sql
CREATE TYPE public.event_type AS ENUM (
  'wedding', 'birthday', 'party', 'graduation', 'funeral', 'naming', 'other'
);

CREATE TYPE public.event_status AS ENUM (
  'draft', 'scheduled', 'live', 'ended'
);

CREATE TABLE public.events (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  host_id UUID NOT NULL REFERENCES public.users(id),
  title VARCHAR(200) NOT NULL,
  type event_type NOT NULL,
  description TEXT,
  location VARCHAR(500),
  event_date DATE,
  event_time TIME,
  event_code VARCHAR(10) NOT NULL UNIQUE, -- 6-char alphanumeric
  status event_status NOT NULL DEFAULT 'draft',
  is_private BOOLEAN DEFAULT false,
  max_participants INT,
  
  -- Aggregates (denormalized for performance, updated via triggers)
  participant_count INT NOT NULL DEFAULT 0,
  total_sprayed BIGINT NOT NULL DEFAULT 0,
  
  -- Moderation
  flagged BOOLEAN DEFAULT false,
  flag_reason TEXT,
  
  scheduled_at TIMESTAMPTZ,
  started_at TIMESTAMPTZ,
  ended_at TIMESTAMPTZ,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE INDEX idx_events_host ON public.events(host_id);
CREATE INDEX idx_events_code ON public.events(event_code);
CREATE INDEX idx_events_status ON public.events(status);
CREATE INDEX idx_events_flagged ON public.events(flagged) WHERE flagged = true;
```

### 2.11 Event Participants

```sql
CREATE TABLE public.event_participants (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  event_id UUID NOT NULL REFERENCES public.events(id) ON DELETE CASCADE,
  user_id UUID NOT NULL REFERENCES public.users(id),
  role VARCHAR(20) NOT NULL DEFAULT 'guest' CHECK (role IN ('host', 'guest', 'co-host')),
  total_sprayed BIGINT NOT NULL DEFAULT 0,
  joined_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  UNIQUE (event_id, user_id)
);

CREATE INDEX idx_participants_event ON public.event_participants(event_id);
CREATE INDEX idx_participants_user ON public.event_participants(user_id);
```

### 2.12 Spray Records

```sql
CREATE TABLE public.spray_records (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  event_id UUID NOT NULL REFERENCES public.events(id),
  sprayer_id UUID NOT NULL REFERENCES public.users(id),
  receiver_id UUID NOT NULL REFERENCES public.users(id), -- event host
  transaction_id UUID REFERENCES public.transactions(id),
  amount BIGINT NOT NULL CHECK (amount > 0),
  denomination INT NOT NULL CHECK (denomination IN (200, 500, 1000)), -- Note size
  note_count INT NOT NULL,
  sprayed_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE INDEX idx_spray_event ON public.spray_records(event_id);
CREATE INDEX idx_spray_sprayer ON public.spray_records(sprayer_id);
```

### 2.13 Giveaways

```sql
CREATE TABLE public.giveaways (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  creator_id UUID NOT NULL REFERENCES public.users(id),
  title VARCHAR(200) NOT NULL,
  total_amount BIGINT NOT NULL CHECK (total_amount >= 10000), -- Min ₦100 (in kobo)
  per_person_amount BIGINT NOT NULL CHECK (per_person_amount >= 1000), -- Min ₦10
  remaining_amount BIGINT NOT NULL,
  code VARCHAR(10) NOT NULL UNIQUE,
  status VARCHAR(20) NOT NULL DEFAULT 'active' CHECK (status IN ('active', 'stopped', 'exhausted')),
  type VARCHAR(20) NOT NULL CHECK (type IN ('live', 'scheduled')),
  event_id UUID REFERENCES public.events(id),
  is_private BOOLEAN DEFAULT false,
  show_on_event_screen BOOLEAN DEFAULT true,
  
  -- Linked transaction for the funding debit
  funding_transaction_id UUID REFERENCES public.transactions(id),
  
  stopped_at TIMESTAMPTZ,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE INDEX idx_giveaways_creator ON public.giveaways(creator_id);
CREATE INDEX idx_giveaways_code ON public.giveaways(code);
CREATE INDEX idx_giveaways_event ON public.giveaways(event_id);
CREATE INDEX idx_giveaways_status ON public.giveaways(status);
```

### 2.14 Giveaway Redemptions

```sql
CREATE TABLE public.giveaway_redemptions (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  giveaway_id UUID NOT NULL REFERENCES public.giveaways(id),
  user_id UUID NOT NULL REFERENCES public.users(id),
  amount BIGINT NOT NULL,
  transaction_id UUID REFERENCES public.transactions(id),
  redeemed_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  UNIQUE (giveaway_id, user_id) -- One redemption per user per giveaway
);

CREATE INDEX idx_redemptions_giveaway ON public.giveaway_redemptions(giveaway_id);
CREATE INDEX idx_redemptions_user ON public.giveaway_redemptions(user_id);
```

### 2.15 Webhook Logs (Audit Trail)

```sql
CREATE TABLE public.webhook_logs (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  provider VARCHAR(20) NOT NULL,
  event_type VARCHAR(100),
  payload JSONB NOT NULL,
  headers JSONB,
  signature VARCHAR(255),
  processed BOOLEAN DEFAULT false,
  processing_error TEXT,
  idempotency_key VARCHAR(255),
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  processed_at TIMESTAMPTZ
);

CREATE INDEX idx_webhook_provider ON public.webhook_logs(provider);
CREATE INDEX idx_webhook_processed ON public.webhook_logs(processed);
CREATE INDEX idx_webhook_idempotency ON public.webhook_logs(idempotency_key);
```

### 2.16 Monnify Reserved Accounts

```sql
CREATE TABLE public.monnify_reserved_accounts (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id UUID NOT NULL REFERENCES public.users(id) ON DELETE CASCADE,
  wallet_id UUID NOT NULL REFERENCES public.wallets(id),
  account_reference VARCHAR(100) NOT NULL UNIQUE,
  account_name VARCHAR(200) NOT NULL,
  account_number VARCHAR(10) NOT NULL,
  bank_name VARCHAR(100) NOT NULL,
  bank_code VARCHAR(10) NOT NULL,
  reservation_reference VARCHAR(100),
  status VARCHAR(20) NOT NULL DEFAULT 'ACTIVE',
  created_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE INDEX idx_monnify_user ON public.monnify_reserved_accounts(user_id);
CREATE INDEX idx_monnify_acct_ref ON public.monnify_reserved_accounts(account_reference);
```

### 2.17 Notifications (Optional but recommended)

```sql
CREATE TABLE public.notifications (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id UUID NOT NULL REFERENCES public.users(id) ON DELETE CASCADE,
  type VARCHAR(50) NOT NULL, -- 'kyc_approved', 'deposit_received', 'spray_received', 'giveaway_redeemed', etc.
  title VARCHAR(200) NOT NULL,
  body TEXT,
  data JSONB,
  read BOOLEAN DEFAULT false,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE INDEX idx_notif_user ON public.notifications(user_id);
CREATE INDEX idx_notif_unread ON public.notifications(user_id, read) WHERE read = false;
```

---

## 3. Authentication & Authorization

### 3.1 User Authentication

| Flow | Details |
|---|---|
| **Method** | Phone number + OTP (SMS) |
| **Format** | Nigerian: `+234XXXXXXXXXX` |
| **OTP Length** | 6 digits |
| **OTP Expiry** | 5 minutes |
| **Rate Limit** | Max 3 OTP requests per phone per 10 minutes |
| **Provider** | Supabase Auth (built-in phone auth) or custom via Termii/AfricasTalking |

### 3.2 Session Management

- Use **JWT tokens** with short expiry (15 min access, 7 day refresh)
- Store refresh token in httpOnly secure cookie
- Rotate refresh tokens on each use
- Invalidate all sessions on password change

### 3.3 Admin Authentication

- Email + password (separate from user phone auth)
- **First login flow**: Invited admins must set password on first login
- **Mandatory password change** after admin-initiated reset
- **Session timeout**: 30 minutes of inactivity
- **2FA recommended** for super_admin and finance roles

### 3.4 Role-Based Permissions

| Role | Permissions |
|---|---|
| `super_admin` | Full access to everything |
| `finance` | Dashboard, transactions, reports, refunds |
| `support` | Dashboard, user management (view/suspend), transactions (view only) |
| `compliance` | Dashboard, KYC review, user data (view) |
| `moderation` | Dashboard, events (flag/end), user data (view) |

**Enforcement**: All admin endpoints MUST call `has_admin_role()` server-side. Never trust client-side role checks.

---

## 4. KYC System (Dojah Integration)

### 4.1 KYC Levels & Gates

| Level | Verification | Unlocks |
|---|---|---|
| **0** | None (just signed up) | View wallet |
| **1** | Phone OTP + Email OTP | Receive in-app transfers |
| **2** | BVN Validation (Dojah) | Fund NGN wallet (Monnify reserved account created), receive USDT (Blockradar address created), send in-app |
| **3** | NIN + Selfie Biometric Match (Dojah) | Withdraw NGN to bank, withdraw USDT externally |

### 4.2 Dojah API Endpoints

**Base URL**: `https://api.dojah.io`

| Operation | Endpoint | Method |
|---|---|---|
| BVN Lookup | `/api/v1/kyc/bvn` | GET |
| BVN Full | `/api/v1/kyc/bvn/full` | GET |
| NIN Lookup | `/api/v1/kyc/nin` | GET |
| Selfie BVN Match | `/api/v1/kyc/selfie/bvn_verification` | POST |
| Selfie NIN Match | `/api/v1/kyc/selfie/nin_verification` | POST |
| Phone Number Verification | `/api/v1/kyc/phone_number` | GET |

**Headers Required**:
```
Authorization: <APP_ID>
AppId: <APP_ID>
```

### 4.3 Level 2 Flow (BVN)

```
1. User submits BVN (11 digits) + Date of Birth
2. Backend calls Dojah: GET /api/v1/kyc/bvn?bvn={bvn}
3. Validate response: name matches user profile (fuzzy match)
4. Validate DOB matches
5. Store BVN hash (SHA-256), last 4 digits, name data
6. Update user.kyc_level = 2
7. Auto-trigger: Create Monnify reserved account
8. Auto-trigger: Create Blockradar USDT address
```

### 4.4 Level 3 Flow (NIN + Selfie)

```
1. User submits NIN (11 digits) + selfie photo
2. Backend calls Dojah: POST /api/v1/kyc/selfie/nin_verification
   Body: { nin: "...", selfie_image: "<base64>" }
3. Validate confidence score >= 80%
4. Cross-validate: NIN name matches BVN name
5. Store NIN hash, confidence score, image reference
6. Update user.kyc_level = 3
```

### 4.5 Security Requirements

- **Never store raw BVN or NIN** — store SHA-256 hash + last 4 digits only
- **Selfie images**: Store in encrypted bucket with time-limited signed URLs
- **Rate limit**: Max 3 KYC attempts per user per 24 hours
- **Admin override**: Compliance role can manually approve/reject KYC
- **Audit log**: All KYC attempts logged with Dojah response

---

## 5. Wallet & Ledger System

### 5.1 Currency Units

| Currency | Display Unit | Storage Unit | Conversion |
|---|---|---|---|
| NGN | Naira (₦) | Kobo | 1 NGN = 100 kobo |
| USDT | USDT | Micro-USDT | 1 USDT = 1,000,000 units |

**CRITICAL**: All amounts in the database are stored as **integers in the smallest unit** to avoid floating-point errors.

### 5.2 Double-Entry Ledger Rules

Every financial operation creates:
1. A `transactions` record
2. One or more `ledger_entries` records (debit and/or credit)

For **internal transfers**, two transaction records are created (sender debit + receiver credit) plus a `transfers` record linking them.

### 5.3 Balance Operations (Atomic)

All balance changes MUST use database transactions with row-level locking:

```sql
-- Example: Debit wallet atomically
BEGIN;
  SELECT balance, locked_balance FROM wallets WHERE id = $1 FOR UPDATE;
  -- Validate: balance - locked_balance >= amount + fee
  UPDATE wallets SET balance = balance - ($2 + $3), updated_at = now() WHERE id = $1;
  INSERT INTO transactions (...) VALUES (...);
  INSERT INTO ledger_entries (...) VALUES (...);
COMMIT;
```

### 5.4 Locked Balances

Used during pending withdrawals:
1. Lock funds: `locked_balance += amount`
2. On completion: `balance -= amount`, `locked_balance -= amount`
3. On failure: `locked_balance -= amount` (refund the lock)

### 5.5 Fee Schedule

| Operation | Fee | Notes |
|---|---|---|
| NGN deposit (bank transfer) | Free | Monnify reserved account |
| NGN deposit (card) | 1.5% | Monnify payment |
| USDT deposit | Free | Blockchain network fees paid by sender |
| In-app transfer (NGN) | Free | Off-chain |
| In-app transfer (USDT) | Free | Off-chain |
| Spray | Free | Off-chain |
| NGN withdrawal to bank | ₦50 flat | Monnify disbursement |
| USDT withdrawal (Blockradar) | Network gas fee | Variable by network |
| USDT withdrawal (Quidax) | Quidax fee | Per their schedule |

---

## 6. Financial Provider Integrations

### 6.1 Monnify (NGN Operations)

**Base URL**: `https://api.monnify.com` (live) / `https://sandbox.monnify.com` (test)

**Authentication**: Basic Auth → Get Bearer Token

```
POST /api/v1/auth/login
Authorization: Basic base64(apiKey:secretKey)
→ Returns: { accessToken, expiresIn }
```

#### 6.1.1 Reserved Account Creation

```
POST /api/v2/bank-transfer/reserved-accounts
Headers: Authorization: Bearer {token}
Body: {
  accountReference: "DOINGS-{userId}",
  accountName: "DOINGS/{userName}",
  currencyCode: "NGN",
  contractCode: "{MONNIFY_CONTRACT_CODE}",
  customerEmail: "{email}",
  customerName: "{name}",
  bvn: "{bvn}", // Required
  getAllAvailableBanks: false,
  preferredBanks: ["035"] // Wema Bank
}
```

**Trigger**: Auto-create when user completes KYC Level 2

#### 6.1.2 Deposit Notification (Webhook)

Monnify sends `POST` to your webhook URL when funds arrive:

```json
{
  "eventType": "SUCCESSFUL_TRANSACTION",
  "eventData": {
    "transactionReference": "...",
    "paymentReference": "...",
    "amountPaid": 50000,
    "paidOn": "2026-02-22T10:30:00.000+0000",
    "paymentStatus": "PAID",
    "accountReference": "DOINGS-{userId}",
    "product": { "reference": "...", "type": "RESERVED_ACCOUNT" }
  }
}
```

#### 6.1.3 Bank Disbursement (Withdrawal)

```
POST /api/v2/disbursements/single
Body: {
  amount: 50000,
  reference: "WD-{uuid}",
  narration: "Doings Withdrawal",
  destinationBankCode: "058",
  destinationAccountNumber: "0123456789",
  currency: "NGN",
  sourceAccountNumber: "{MONNIFY_SOURCE_ACCOUNT}"
}
```

#### 6.1.4 Account Name Verification

```
GET /api/v1/disbursements/account/validate?accountNumber={num}&bankCode={code}
→ Returns: { accountName, accountNumber, bankCode }
```

### 6.2 Blockradar (USDT — Direct Blockchain)

**Base URL**: `https://api.blockradar.io/v1`

**Auth Header**: `x-api-key: {BLOCKRADAR_API_KEY}`

#### 6.2.1 Generate Deposit Address

```
POST /wallets/{walletId}/addresses
Body: {
  name: "DOINGS-{userId}",
  network: "tron" // or "bsc", "ethereum"
}
→ Returns: { address, network, blockchain }
```

**Auto-sweep**: Blockradar auto-sweeps incoming USDT to your main wallet. Configure via dashboard.

#### 6.2.2 Deposit Webhook

```json
{
  "event": "deposit.success",
  "data": {
    "address": "TXyz...",
    "amount": "50.00",
    "asset": "USDT",
    "network": "tron",
    "hash": "abc123..."
  }
}
```

#### 6.2.3 Send USDT (Withdrawal)

```
POST /wallets/{walletId}/withdraw
Body: {
  address: "TXyz...",
  amount: "50.00",
  asset: "USDT",
  network: "tron",
  metadata: { userId: "...", reference: "..." }
}
```

### 6.3 Quidax (USDT — Exchange)

**Base URL**: `https://www.quidax.com/api/v1`

**Auth Header**: `Authorization: Bearer {QUIDAX_SECRET_KEY}`

#### 6.3.1 Create Sub-User

```
POST /users
Body: { email: "doings-{userId}@doings.app", first_name: "...", last_name: "..." }
→ Returns: { id, email }
```

#### 6.3.2 Get Deposit Address

```
GET /users/{subUserId}/wallets/usdt/address
→ Returns: { address, network }
```

#### 6.3.3 Withdraw USDT

```
POST /users/{subUserId}/withdraws
Body: {
  currency: "usdt",
  amount: "50",
  fund_uid: "TXyz...", // destination address
  transaction_note: "Doings withdrawal",
  narration: "WD-{reference}"
}
```

#### 6.3.4 Strategy: When to Use Which

| Scenario | Provider | Reason |
|---|---|---|
| User deposits USDT | **Blockradar** | Direct blockchain addresses, auto-sweep |
| User withdraws small USDT | **Quidax** | Lower fees for small amounts |
| User withdraws large USDT | **Blockradar** | Direct on-chain, predictable fees |
| USDT ↔ NGN swap | **Quidax** | Exchange functionality built-in |

---

## 7. Events System

### 7.1 Event Lifecycle

```
Draft → Scheduled → Live → Ended
```

### 7.2 Event Code Generation

- 6-character alphanumeric (A-Z, 0-9)
- Must be unique
- Case-insensitive matching
- Characters excluded for readability: `0, O, I, L, 1`

### 7.3 Spraying Flow

```
1. User joins event (via code)
2. User selects spray amount and denomination (200/500/1000)
3. Frontend shows spray animation
4. On completion, backend:
   a. Debits sprayer's NGN wallet
   b. Credits host's NGN wallet  
   c. Creates spray_record
   d. Updates event.total_sprayed
   e. Updates event_participants.total_sprayed
```

### 7.4 Real-time Updates

Use **Supabase Realtime** or **WebSocket** for:
- Live participant count updates
- Spray feed (who sprayed how much)
- Event status changes (go live, end)
- Giveaway announcements during events

### 7.5 Event Endpoints

| Method | Endpoint | Description | Auth |
|---|---|---|---|
| POST | `/events` | Create event | User (KYC ≥ 1) |
| GET | `/events` | List public events | Public |
| GET | `/events/:id` | Get event details | Public |
| GET | `/events/code/:code` | Find by code | Public |
| PUT | `/events/:id` | Update event | Host only |
| POST | `/events/:id/go-live` | Start event | Host only |
| POST | `/events/:id/end` | End event | Host only |
| DELETE | `/events/:id` | Delete draft event | Host only |
| POST | `/events/:id/join` | Join event | User |
| POST | `/events/:id/spray` | Spray money | User (KYC ≥ 2) |
| GET | `/events/:id/participants` | List participants | Host/participant |
| GET | `/events/:id/sprays` | Spray history | Host |

---

## 8. Giveaways System

### 8.1 Giveaway Flow

```
1. Creator sets: title, total_amount, per_person_amount, type (live/scheduled), privacy
2. System debits creator's wallet for total_amount
3. System generates unique 6-char code
4. Recipients enter code to redeem
5. Each redemption:
   a. Validates: not already redeemed, not creator, giveaway active, funds remaining
   b. Credits recipient's wallet (per_person_amount)
   c. Decrements remaining_amount
   d. If remaining < per_person: mark as 'exhausted'
6. Creator can stop giveaway → remaining_amount refunded to creator
```

### 8.2 Giveaway Endpoints

| Method | Endpoint | Description |
|---|---|---|
| POST | `/giveaways` | Create giveaway (debits wallet) |
| GET | `/giveaways/my` | List creator's giveaways |
| GET | `/giveaways/:id` | Get giveaway details |
| POST | `/giveaways/redeem` | Redeem by code |
| POST | `/giveaways/:id/stop` | Stop + refund remaining |
| GET | `/giveaways/event/:eventId` | Get event giveaways |

### 8.3 Validation Rules

- Creator cannot redeem own giveaway
- One redemption per user per giveaway
- Minimum total: ₦100
- Minimum per person: ₦10
- per_person_amount must be ≤ total_amount
- Balance check before creation

---

## 9. Leaderboard System

### 9.1 Ranking Logic

Rank users by **total gifted** = sum of spray amounts + giveaway amounts.

### 9.2 Time Periods

| Period | Calculation |
|---|---|
| Weekly | Last 7 days |
| Monthly | Last 30 days |
| All Time | Since account creation |

### 9.3 Implementation Strategy

**Option A (Recommended)**: Materialized view refreshed every 5–15 minutes

```sql
CREATE MATERIALIZED VIEW public.leaderboard_weekly AS
SELECT 
  u.id AS user_id,
  u.full_name,
  u.username,
  u.avatar_url,
  COALESCE(SUM(CASE WHEN t.type = 'spray' THEN ABS(t.amount) ELSE 0 END), 0) AS spray_total,
  COALESCE(SUM(CASE WHEN t.type = 'giveaway' THEN ABS(t.amount) ELSE 0 END), 0) AS giveaway_total,
  COALESCE(SUM(ABS(t.amount)), 0) AS total_gifted,
  COUNT(DISTINCT sr.event_id) AS events_attended,
  RANK() OVER (ORDER BY COALESCE(SUM(ABS(t.amount)), 0) DESC) AS rank
FROM public.users u
LEFT JOIN public.transactions t ON t.user_id = u.id 
  AND t.type IN ('spray', 'giveaway')
  AND t.status = 'completed'
  AND t.created_at >= now() - INTERVAL '7 days'
  AND t.amount < 0 -- Only debits (gifting)
LEFT JOIN public.spray_records sr ON sr.sprayer_id = u.id
  AND sr.sprayed_at >= now() - INTERVAL '7 days'
GROUP BY u.id, u.full_name, u.username, u.avatar_url
ORDER BY total_gifted DESC
LIMIT 100;

-- Refresh periodically
REFRESH MATERIALIZED VIEW CONCURRENTLY public.leaderboard_weekly;
```

**Option B**: Redis sorted sets for real-time ranking (more complex, faster updates)

### 9.4 Endpoints

| Method | Endpoint | Description |
|---|---|---|
| GET | `/leaderboard?period=weekly` | Get leaderboard |
| GET | `/leaderboard/me?period=weekly` | Current user's rank |

---

## 10. Admin System

### 10.1 Admin Endpoints

#### User Management

| Method | Endpoint | Description | Role |
|---|---|---|---|
| GET | `/admin/users` | List all users (paginated, filterable) | support, super_admin |
| GET | `/admin/users/:id` | User detail with wallet & KYC info | support, super_admin |
| POST | `/admin/users/:id/suspend` | Suspend user | support, super_admin |
| POST | `/admin/users/:id/unsuspend` | Unsuspend user | support, super_admin |
| POST | `/admin/users/:id/ban` | Ban user permanently | super_admin |

#### Transaction Management

| Method | Endpoint | Description | Role |
|---|---|---|---|
| GET | `/admin/transactions` | List all transactions (paginated, filterable) | finance, support (view), super_admin |
| GET | `/admin/transactions/:id` | Transaction detail | finance, super_admin |
| POST | `/admin/transactions/:id/refund` | Refund transaction | finance, super_admin |
| POST | `/admin/transactions/:id/flag` | Flag suspicious transaction | finance, super_admin |
| POST | `/admin/transactions/:id/unflag` | Remove flag | finance, super_admin |

#### KYC Management

| Method | Endpoint | Description | Role |
|---|---|---|---|
| GET | `/admin/kyc` | List KYC submissions (pending first) | compliance, super_admin |
| GET | `/admin/kyc/:id` | KYC submission detail + documents | compliance, super_admin |
| POST | `/admin/kyc/:id/approve` | Approve KYC | compliance, super_admin |
| POST | `/admin/kyc/:id/reject` | Reject KYC with reason | compliance, super_admin |

#### Event Management

| Method | Endpoint | Description | Role |
|---|---|---|---|
| GET | `/admin/events` | List all events | moderation, super_admin |
| POST | `/admin/events/:id/flag` | Flag event | moderation, super_admin |
| POST | `/admin/events/:id/unflag` | Unflag event | moderation, super_admin |
| POST | `/admin/events/:id/end` | Force-end event | moderation, super_admin |

#### Team Management (Super Admin Only)

| Method | Endpoint | Description |
|---|---|---|
| GET | `/admin/team` | List all admin accounts |
| POST | `/admin/team/invite` | Invite new admin |
| PUT | `/admin/team/:id/role` | Change admin role |
| POST | `/admin/team/:id/disable` | Disable admin |
| POST | `/admin/team/:id/enable` | Re-enable admin |
| POST | `/admin/team/:id/reset-password` | Force password reset |
| DELETE | `/admin/team/:id` | Remove admin |

#### Dashboard

| Method | Endpoint | Description |
|---|---|---|
| GET | `/admin/stats` | Platform statistics |
| GET | `/admin/stats/daily` | Daily volume chart data |
| GET | `/admin/reports/transactions` | Export transactions CSV |

### 10.2 Dashboard Statistics

```json
{
  "totalUsers": 15000,
  "activeUsers": 12000,
  "suspendedUsers": 150,
  "pendingKYC": 45,
  "totalTransactions": 250000,
  "totalVolume": 1500000000, // in kobo
  "todayVolume": 25000000,
  "activeEvents": 34,
  "totalEvents": 1200,
  "flaggedTransactions": 8
}
```

---

## 11. API Endpoints — Full Reference

### 11.1 Auth

| Method | Endpoint | Body | Response |
|---|---|---|---|
| POST | `/auth/send-otp` | `{ phone: "+234..." }` | `{ message: "OTP sent" }` |
| POST | `/auth/verify-otp` | `{ phone, otp }` | `{ user, access_token, refresh_token }` |
| POST | `/auth/refresh` | `{ refresh_token }` | `{ access_token, refresh_token }` |
| POST | `/auth/logout` | — | `{ message: "Logged out" }` |

### 11.2 User Profile

| Method | Endpoint | Description |
|---|---|---|
| GET | `/users/me` | Get current user profile |
| PUT | `/users/me` | Update profile (name, email, avatar) |
| PUT | `/users/me/avatar` | Upload/update avatar data |

### 11.3 KYC

| Method | Endpoint | Body | KYC Gate |
|---|---|---|---|
| GET | `/kyc/status` | — | Any |
| POST | `/kyc/verify-level1` | `{ phone, email, fullName }` | Level 0 |
| POST | `/kyc/verify-level2` | `{ bvn, dateOfBirth }` | Level 1 |
| POST | `/kyc/verify-level3` | `{ nin, selfieBase64 }` | Level 2 |

### 11.4 Wallets

| Method | Endpoint | Description | KYC Gate |
|---|---|---|---|
| GET | `/wallets` | Get user's wallets (NGN + USDT) | Level 0 |
| GET | `/wallets/:currency/balance` | Get balance | Level 0 |
| POST | `/wallets/ngn/create-reserved-account` | Create Monnify account | Level 2 (auto) |
| POST | `/wallets/usdt/create-address` | Create Blockradar address | Level 2 |
| GET | `/wallets/:currency/transactions` | Transaction history | Level 0 |

### 11.5 Funding

| Method | Endpoint | Body | KYC Gate |
|---|---|---|---|
| POST | `/fund/ngn/card` | `{ amount }` → redirect to Monnify | Level 2 |
| GET | `/fund/ngn/account-details` | Get reserved account number | Level 2 |
| GET | `/fund/usdt/address?network=TRC20` | Get/create USDT address | Level 2 |

### 11.6 Withdrawals

| Method | Endpoint | Body | KYC Gate |
|---|---|---|---|
| POST | `/withdraw/ngn` | `{ amount, bankAccountId }` | Level 3 |
| POST | `/withdraw/usdt` | `{ amount, toAddress, network, provider }` | Level 3 |
| GET | `/withdraw/ngn/fee?amount=50000` | Calculate fee | Level 3 |
| GET | `/withdraw/usdt/fee?amount=50&network=TRC20` | Calculate fee | Level 3 |

### 11.7 Transfers (In-App)

| Method | Endpoint | Body | KYC Gate |
|---|---|---|---|
| POST | `/transfers/send` | `{ recipientPhone, amount, currency, description }` | Level 2 |
| GET | `/transfers/lookup?phone=+234...` | Lookup recipient | Level 2 |

### 11.8 Bank Accounts

| Method | Endpoint | Description | KYC Gate |
|---|---|---|---|
| GET | `/bank-accounts` | List saved accounts | Level 2 |
| POST | `/bank-accounts` | Add + verify account | Level 2 |
| DELETE | `/bank-accounts/:id` | Remove account | Level 2 |
| PUT | `/bank-accounts/:id/default` | Set as default | Level 2 |
| GET | `/bank-accounts/verify?bankCode=058&accountNumber=0123456789` | Verify account name | Level 2 |

### 11.9 Events

See [Section 7.5](#75-event-endpoints)

### 11.10 Giveaways

See [Section 8.2](#82-giveaway-endpoints)

### 11.11 Leaderboard

See [Section 9.4](#94-endpoints)

---

## 12. Webhooks

### 12.1 Webhook Endpoints to Create

| Provider | Endpoint | Purpose |
|---|---|---|
| Monnify | `POST /webhooks/monnify` | Deposit notifications |
| Monnify | `POST /webhooks/monnify/disbursement` | Withdrawal status updates |
| Blockradar | `POST /webhooks/blockradar` | USDT deposit + withdrawal confirmations |
| Quidax | `POST /webhooks/quidax` | Deposit/withdrawal status updates |

### 12.2 Webhook Processing Rules

1. **Log everything**: Store raw payload + headers in `webhook_logs` before processing
2. **Verify signature**: Each provider has specific HMAC verification
3. **Idempotency**: Check `idempotency_key` / `transactionReference` to prevent double-processing
4. **Async processing**: Accept webhook immediately (200 OK), process in background queue
5. **Retry handling**: Providers retry on non-2xx — ensure idempotent processing

### 12.3 Monnify Webhook Verification

```javascript
const crypto = require('crypto');

function verifyMonnifySignature(payload, signature, secretKey) {
  const hash = crypto
    .createHmac('sha512', secretKey)
    .update(JSON.stringify(payload))
    .digest('hex');
  return hash === signature;
}
```

### 12.4 Blockradar Webhook Verification

```javascript
function verifyBlockradarSignature(payload, signature, secretKey) {
  const hash = crypto
    .createHmac('sha256', secretKey)
    .update(JSON.stringify(payload))
    .digest('hex');
  return hash === signature;
}
```

---

## 13. Security & Vulnerability Measures

### 13.1 Authentication Security

- [ ] **Rate limit OTP requests**: Max 3 per phone per 10 minutes, max 10 per IP per hour
- [ ] **OTP brute-force protection**: Lock account after 5 failed attempts (15-minute cooldown)
- [ ] **JWT rotation**: Short-lived access tokens (15 min), rotate refresh tokens
- [ ] **Admin 2FA**: Required for super_admin and finance roles
- [ ] **Session invalidation**: Logout invalidates all tokens for that user

### 13.2 Financial Security

- [ ] **Atomic transactions**: All balance changes use `SELECT ... FOR UPDATE` with database transactions
- [ ] **Idempotency keys**: Every monetary operation has a unique key; duplicates return existing result
- [ ] **Double-entry ledger**: Every debit has a corresponding credit; running audit checks
- [ ] **Balance assertions**: Trigger/constraint ensures `balance >= 0` and `locked_balance <= balance`
- [ ] **Daily reconciliation**: Automated job comparing wallet balances vs ledger entry sums
- [ ] **Anomaly detection**: Flag transactions > ₦500,000 or > 10 transactions per hour per user
- [ ] **Withdrawal limits**: Daily/weekly limits based on KYC level
  - Level 3: ₦500,000/day NGN, $1,000/day USDT
- [ ] **Cooldown on first withdrawal**: 24-hour hold after first withdrawal attempt

### 13.3 Input Validation

- [ ] **Phone format**: Validate `+234` prefix, 10 digits after
- [ ] **BVN/NIN**: Exactly 11 digits, numeric only
- [ ] **Account numbers**: Exactly 10 digits (NUBAN)
- [ ] **Amounts**: Positive integers only, within defined min/max
- [ ] **Event codes**: Alphanumeric, 6 chars, sanitized
- [ ] **SQL injection**: Use parameterized queries exclusively (Supabase client handles this)
- [ ] **XSS**: Sanitize all user-generated content (event names, descriptions)

### 13.4 API Security

- [ ] **Rate limiting**: Per-IP and per-user limits on all endpoints
  - Auth: 3 req/10min
  - Financial: 10 req/min
  - General: 60 req/min
- [ ] **CORS**: Whitelist only the frontend domain
- [ ] **Helmet headers**: `X-Content-Type-Options`, `X-Frame-Options`, `Strict-Transport-Security`
- [ ] **Request size limit**: Max 5MB (for selfie upload)
- [ ] **Content-Type validation**: Reject requests with unexpected content types

### 13.5 Data Security

- [ ] **PII encryption**: BVN, NIN stored as SHA-256 hashes only
- [ ] **Selfie images**: Encrypted at rest, time-limited signed URLs, auto-delete after KYC approval
- [ ] **Database encryption**: Enable transparent data encryption (TDE)
- [ ] **Backup encryption**: All backups encrypted with separate key
- [ ] **Log sanitization**: Never log BVN, NIN, account numbers, or tokens
- [ ] **Webhook payloads**: Encrypt sensitive fields in webhook_logs

### 13.6 Infrastructure Security

- [ ] **API keys**: All provider keys in environment variables / secrets manager (never in code)
- [ ] **Network isolation**: Database not publicly accessible
- [ ] **WAF**: Web Application Firewall on API gateway
- [ ] **DDoS protection**: Cloudflare or equivalent
- [ ] **Penetration testing**: Before launch and quarterly thereafter
- [ ] **Dependency scanning**: Automated vulnerability scanning of dependencies

### 13.7 Admin Security

- [ ] **Roles in separate table**: Never store admin role on users table (prevents privilege escalation)
- [ ] **Server-side role checks**: `has_admin_role()` called on every admin endpoint
- [ ] **Audit trail**: All admin actions logged (who did what, when)
- [ ] **IP whitelisting**: Optional — restrict admin access to office IP ranges
- [ ] **Session timeout**: 30 minutes idle timeout for admin sessions
- [ ] **No client-side auth**: Never check admin status via localStorage or hardcoded credentials

### 13.8 Monitoring & Alerting

- [ ] **Failed login alerts**: > 10 failed attempts from same IP
- [ ] **Large transaction alerts**: Transactions exceeding daily thresholds
- [ ] **Webhook failure alerts**: > 3 consecutive webhook processing failures
- [ ] **Balance discrepancy alerts**: Ledger balance ≠ wallet balance
- [ ] **KYC fraud alerts**: Same BVN/NIN used by multiple accounts
- [ ] **API error rate alerts**: > 5% error rate on any endpoint

---

## 14. DevOps & Infrastructure

### 14.1 Recommended Stack

| Component | Recommendation | Alternative |
|---|---|---|
| **Database** | Supabase (PostgreSQL 15+) | AWS RDS PostgreSQL |
| **API Server** | Supabase Edge Functions (Deno) | Node.js + Express on AWS ECS |
| **Cache** | Upstash Redis | AWS ElastiCache |
| **File Storage** | Supabase Storage | AWS S3 |
| **CDN** | Cloudflare | AWS CloudFront |
| **Monitoring** | Sentry + Grafana | Datadog |
| **CI/CD** | GitHub Actions | GitLab CI |
| **Secrets** | Supabase Secrets / AWS SSM | HashiCorp Vault |
| **Message Queue** | Upstash QStash | AWS SQS / Bull + Redis |
| **Real-time** | Supabase Realtime | Pusher / Socket.IO |

### 14.2 Environment Setup

| Environment | Purpose | Database |
|---|---|---|
| **Development** | Local development | Local PostgreSQL / Supabase CLI |
| **Staging** | QA & testing | Separate Supabase project (sandbox APIs) |
| **Production** | Live users | Production Supabase project (live APIs) |

### 14.3 Database Management

- **Migrations**: Use Supabase migrations or Flyway/Liquibase
- **Backups**: Automated daily backups with 30-day retention
- **Point-in-time recovery**: Enable WAL archiving for PITR
- **Read replicas**: Add when query load exceeds primary capacity

### 14.4 Deployment Pipeline

```
1. Developer pushes to feature branch
2. CI runs: lint → type check → unit tests → integration tests
3. PR review + approval
4. Merge to `develop` → auto-deploy to staging
5. QA validation on staging
6. Merge to `main` → deploy to production
7. Post-deployment: smoke tests → monitoring check
```

### 14.5 Scaling Strategy

| Component | Initial | Growth | Scale |
|---|---|---|---|
| API | Single Supabase project | Add edge function instances | Dedicated Node cluster |
| Database | Supabase Pro (8GB) | Supabase Team (32GB) | Dedicated PostgreSQL cluster |
| Cache | Upstash free tier | Upstash Pro | Dedicated Redis cluster |
| Background Jobs | Supabase pg_cron | QStash scheduled tasks | Dedicated worker service |

### 14.6 Background Jobs

| Job | Schedule | Purpose |
|---|---|---|
| `reconcile_balances` | Every 6 hours | Verify wallet balance = sum of ledger entries |
| `refresh_leaderboard` | Every 15 minutes | Refresh materialized views |
| `expire_pending_txns` | Every hour | Mark stale pending transactions as failed |
| `cleanup_webhook_logs` | Daily | Archive webhook logs older than 90 days |
| `kyc_selfie_cleanup` | Daily | Delete selfie images after KYC approval + 30 days |
| `generate_daily_report` | Daily at midnight | Aggregate daily stats |
| `check_anomalies` | Every 30 minutes | Flag suspicious transaction patterns |

### 14.7 Logging Standards

```json
{
  "timestamp": "2026-02-22T10:30:00Z",
  "level": "info",
  "service": "wallet-service",
  "action": "credit_wallet",
  "userId": "uuid",
  "walletId": "uuid",
  "amount": 5000000,
  "currency": "NGN",
  "transactionId": "uuid",
  "provider": "monnify",
  "duration_ms": 45,
  "ip": "x.x.x.x"
}
```

**Never log**: BVN, NIN, full account numbers, tokens, passwords, selfie data

### 14.8 Health Checks

| Endpoint | Purpose |
|---|---|
| `GET /health` | Basic API health |
| `GET /health/db` | Database connectivity |
| `GET /health/redis` | Cache connectivity |
| `GET /health/providers` | External API status (Monnify, Dojah, etc.) |

---

## 15. Appendix: Environment Variables

### Required Secrets

```env
# Database
DATABASE_URL=postgresql://...
SUPABASE_URL=https://xxx.supabase.co
SUPABASE_SERVICE_ROLE_KEY=eyJ...
SUPABASE_ANON_KEY=eyJ...

# Monnify
MONNIFY_API_KEY=MK_xxxx
MONNIFY_SECRET_KEY=xxxx
MONNIFY_CONTRACT_CODE=xxxx
MONNIFY_BASE_URL=https://api.monnify.com  # or sandbox.monnify.com
MONNIFY_SOURCE_ACCOUNT=xxxx
MONNIFY_WEBHOOK_SECRET=xxxx

# Blockradar
BLOCKRADAR_API_KEY=xxxx
BLOCKRADAR_WALLET_ID=xxxx  # For each network: TRC20, BEP20
BLOCKRADAR_WEBHOOK_SECRET=xxxx

# Quidax
QUIDAX_SECRET_KEY=xxxx
QUIDAX_WEBHOOK_SECRET=xxxx

# Dojah
DOJAH_APP_ID=xxxx
DOJAH_SECRET_KEY=xxxx
DOJAH_WIDGET_ID=xxxx  # If using widget

# SMS (for OTP)
TERMII_API_KEY=xxxx  # or AfricasTalking
TERMII_SENDER_ID=Doings

# Redis
REDIS_URL=redis://...

# App
APP_URL=https://doings.app
ADMIN_URL=https://admin.doings.app
JWT_SECRET=xxxx
ENCRYPTION_KEY=xxxx  # For encrypting PII at rest
```

---

## Changelog

| Date | Version | Changes |
|---|---|---|
| 2026-02-22 | 1.0 | Initial document |

---

**Questions?** Contact the project lead or the frontend team for clarification on any UI/UX flows or data requirements.
