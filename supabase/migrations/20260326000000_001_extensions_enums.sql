-- Migration 001: Extensions & Enums
-- ================================================

-- Enable required extensions
CREATE EXTENSION IF NOT EXISTS "uuid-ossp";
CREATE EXTENSION IF NOT EXISTS "pgcrypto";
CREATE EXTENSION IF NOT EXISTS "pg_trgm";

-- Currency enum
CREATE TYPE public.currency AS ENUM ('NGN', 'USDT');

-- Transaction types
CREATE TYPE public.transaction_type AS ENUM (
  'deposit', 'withdrawal', 'send', 'receive',
  'spray', 'giveaway', 'giveaway_refund', 'swap'
);

-- Transaction status
CREATE TYPE public.transaction_status AS ENUM (
  'pending', 'processing', 'completed', 'failed', 'refunded'
);

-- Event types
CREATE TYPE public.event_type AS ENUM (
  'wedding', 'birthday', 'party', 'graduation',
  'funeral', 'naming', 'other'
);

-- Event status
CREATE TYPE public.event_status AS ENUM (
  'draft', 'scheduled', 'live', 'ended'
);

-- Admin roles
CREATE TYPE public.admin_role AS ENUM (
  'super_admin', 'finance', 'support', 'compliance', 'moderation'
);

-- KYC status
CREATE TYPE public.kyc_status AS ENUM (
  'pending', 'verified', 'rejected'
);

-- Giveaway status
CREATE TYPE public.giveaway_status AS ENUM (
  'active', 'stopped', 'exhausted'
);

-- Giveaway type
CREATE TYPE public.giveaway_type AS ENUM (
  'live', 'scheduled'
);
