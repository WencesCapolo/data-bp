-- Phase 14: the three Stripe Exports nothing fetched yet — clientes,
-- transacciones disputadas, transferencias. See docs/adr/0005 (planes, mirrors)
-- and docs/adr/0006 (the sync steps these tables are filled by).
--
-- Idempotent: CREATE ... IF NOT EXISTS. Safe to re-run.
--
--   psql "$DATABASE_URL" -v ON_ERROR_STOP=1 -f migrations/sql/0014_stripe_customers_disputes_payouts.sql
--
-- All three are MIRRORS in the sense docs/adr/0005 gives the word: rebuildable
-- from the Provider at any time, never a source of truth, never foreign-keyed to
-- basket_payments. Each is keyed the way the Provider keys it, so a row can
-- arrive before the Pago it belongs to — or without one ever arriving.

-- ============================================================================
-- basket_gateway_customers
-- Grain: one row per Provider customer.
--
-- The one thing this table exists for is customer_id -> email: it is the only
-- bridge between a Provider object (subscription, dispute) and a Subscriber,
-- because basket_gateway_subscriptions carries a customer id and nothing else
-- identifying. Everything else here is context.
--
-- Refreshed in full on every sync, for the same reason subscriptions are: an
-- email or a country changes long after the customer was created, and the list
-- endpoint filters on `created` only, so any window would freeze the very field
-- the table exists to carry.
-- ============================================================================
CREATE TABLE IF NOT EXISTS basket_gateway_customers (
  platform    SMALLINT    NOT NULL,
  customer_id TEXT        NOT NULL,
  email       TEXT,
  name        TEXT,
  -- Verbatim from the customer's address; the charge's country can differ and
  -- this one is not evidence of where a Pago was made.
  country     VARCHAR(2),
  currency    VARCHAR(10),
  delinquent  BOOLEAN,
  description TEXT,
  created_at  TIMESTAMPTZ,
  synced_at   TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  CONSTRAINT basket_gateway_customers_platform_customer_id_pk
    PRIMARY KEY (platform, customer_id)
);

-- The join every consumer makes: subscription/dispute -> customer -> email ->
-- Subscriber. Partial because a customer without an email cannot serve it.
CREATE INDEX IF NOT EXISTS basket_gateway_customers_email_idx
  ON basket_gateway_customers(LOWER(email))
  WHERE email IS NOT NULL;

-- ============================================================================
-- basket_gateway_disputes
-- Grain: one row per dispute (chargeback), keyed by the Provider's dispute id.
--
-- Refunds already have a column — basket_payment_fees.refunded_amount — and
-- disputes had none, so a reversed charge was invisible unless it happened to be
-- refunded too. That is the whole reason this table exists.
--
-- PLANE: amount/currency are PRESENTMENT — the disputed amount in the currency
-- the Subscriber was charged, exactly like refunded_amount. Never divide it by a
-- settlement figure, and never sum it across currencies.
--
-- platform_payment_id is the same join key basket_payment_fees uses (the
-- PaymentIntent id, falling back to the charge id), so "which charges were
-- reversed" is one join and needs no id translation.
-- ============================================================================
CREATE TABLE IF NOT EXISTS basket_gateway_disputes (
  platform            SMALLINT       NOT NULL,
  dispute_id          TEXT           NOT NULL,
  platform_payment_id TEXT           NOT NULL,
  charge_id           TEXT,
  amount              NUMERIC(14, 2) NOT NULL,
  currency            VARCHAR(10)    NOT NULL,
  status              TEXT           NOT NULL,
  reason              TEXT,
  -- Stripe charges a non-refundable dispute fee per case; it lands on the
  -- balance transaction, not on the charge, so it is stored here in the
  -- SETTLEMENT plane and must not be added to amount above.
  fee_amount          NUMERIC(14, 2),
  settlement_currency VARCHAR(10),
  is_charge_refundable BOOLEAN,
  evidence_due_by     TIMESTAMPTZ,
  created_at          TIMESTAMPTZ,
  synced_at           TIMESTAMPTZ    NOT NULL DEFAULT NOW(),
  CONSTRAINT basket_gateway_disputes_platform_dispute_id_pk
    PRIMARY KEY (platform, dispute_id)
);

CREATE INDEX IF NOT EXISTS basket_gateway_disputes_payment_idx
  ON basket_gateway_disputes(platform, platform_payment_id);
CREATE INDEX IF NOT EXISTS basket_gateway_disputes_created_at_idx
  ON basket_gateway_disputes(created_at);

-- ============================================================================
-- basket_gateway_payouts
-- Grain: one row per payout — money leaving the Provider for the bank.
--
-- This is the only table in the mirror that lives purely in the SETTLEMENT
-- plane: a payout has no presentment side at all. It answers "what hit the bank
-- on date X", which no other table can, because net_amount sums what was earned,
-- not what was transferred.
--
-- arrival_date is the bank's date and is what a reconciliation is done against;
-- created_at is when Stripe scheduled it. They differ by days. Bucket on
-- arrival_date and say so, as this comment does.
-- ============================================================================
CREATE TABLE IF NOT EXISTS basket_gateway_payouts (
  platform               SMALLINT       NOT NULL,
  payout_id              TEXT           NOT NULL,
  amount                 NUMERIC(14, 2) NOT NULL,
  currency               VARCHAR(10)    NOT NULL,
  status                 TEXT           NOT NULL,
  -- 'bank_account' | 'card', and 'standard' | 'instant'.
  type                   TEXT,
  method                 TEXT,
  automatic              BOOLEAN,
  arrival_date           TIMESTAMPTZ,
  created_at             TIMESTAMPTZ,
  description            TEXT,
  statement_descriptor   TEXT,
  failure_code           TEXT,
  balance_transaction_id TEXT,
  synced_at              TIMESTAMPTZ    NOT NULL DEFAULT NOW(),
  CONSTRAINT basket_gateway_payouts_platform_payout_id_pk
    PRIMARY KEY (platform, payout_id)
);

CREATE INDEX IF NOT EXISTS basket_gateway_payouts_arrival_date_idx
  ON basket_gateway_payouts(arrival_date);
