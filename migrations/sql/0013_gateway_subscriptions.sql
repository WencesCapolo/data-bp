-- Phase 13: Stripe subscription linkage + subscription records.
--
-- Idempotent: ADD COLUMN IF NOT EXISTS / CREATE TABLE IF NOT EXISTS. Re-runnable.
--
--   psql "$DATABASE_URL" -v ON_ERROR_STOP=1 -f migrations/sql/0013_gateway_subscriptions.sql

-- ============================================================================
-- 1. Link each charge to the subscription that produced it.
--
-- The chain is charge -> invoice -> subscription; the charge carries only the
-- invoice id, so the subscription id is resolved by reading the window's
-- invoices alongside its balance transactions. Both ids are stored: invoice_id
-- because it is what the charge actually references and is the only key that
-- can be re-resolved later, subscription_id because it is what every question
-- ("which renewals belong to this subscription", "when did it cancel") is
-- actually asked in terms of.
--
-- Both are NULL for one-off charges, which have no invoice at all. That is a
-- fact about the payment, not a gap in the data.
-- ============================================================================
ALTER TABLE basket_payment_fees ADD COLUMN IF NOT EXISTS invoice_id      TEXT;
ALTER TABLE basket_payment_fees ADD COLUMN IF NOT EXISTS subscription_id TEXT;

CREATE INDEX IF NOT EXISTS basket_payment_fees_subscription_idx
  ON basket_payment_fees(subscription_id)
  WHERE subscription_id IS NOT NULL;

-- ============================================================================
-- 2. basket_gateway_subscriptions
-- Grain: one row per gateway subscription.
--
-- This is the table the cancellation chart needs. Until now churn could only be
-- INFERRED from the gap since a subscriber's last payment (the old dashboard's
-- 60/420-day windows), because no gateway export carried cancellations. The
-- subscription object states it outright: status, cancel_at_period_end,
-- canceled_at, ended_at.
--
-- Refreshed in full on every sync rather than by window — see the fetcher for
-- why: a subscription cancelled today may have been created two years ago, so a
-- window over `created` would never see the event that matters.
-- ============================================================================
CREATE TABLE IF NOT EXISTS basket_gateway_subscriptions (
  platform             SMALLINT    NOT NULL,
  subscription_id      TEXT        NOT NULL,
  customer_id          TEXT,
  status               TEXT        NOT NULL,
  currency             VARCHAR(10),
  amount               NUMERIC(14, 2),
  interval             TEXT,
  interval_count       SMALLINT,
  created_at           TIMESTAMPTZ,
  current_period_start TIMESTAMPTZ,
  current_period_end   TIMESTAMPTZ,
  cancel_at_period_end BOOLEAN     NOT NULL DEFAULT FALSE,
  cancel_at            TIMESTAMPTZ,
  canceled_at          TIMESTAMPTZ,
  ended_at             TIMESTAMPTZ,
  trial_end            TIMESTAMPTZ,
  synced_at            TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  CONSTRAINT basket_gateway_subscriptions_platform_subscription_id_pk
    PRIMARY KEY (platform, subscription_id)
);

CREATE INDEX IF NOT EXISTS basket_gateway_subscriptions_status_idx
  ON basket_gateway_subscriptions(status);
CREATE INDEX IF NOT EXISTS basket_gateway_subscriptions_canceled_at_idx
  ON basket_gateway_subscriptions(canceled_at)
  WHERE canceled_at IS NOT NULL;
CREATE INDEX IF NOT EXISTS basket_gateway_subscriptions_customer_idx
  ON basket_gateway_subscriptions(customer_id);
