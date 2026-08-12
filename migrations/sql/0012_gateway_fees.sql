-- Phase 12: Gateway fees — per-transaction commission, net and settlement FX
-- pulled from the Stripe and MercadoPago APIs. See docs/adr/0005.
--
-- Idempotent: CREATE ... IF NOT EXISTS. Safe to re-run.
--
--   psql "$DATABASE_URL" -v ON_ERROR_STOP=1 -f migrations/sql/0012_gateway_fees.sql
--
-- Nothing here is read by the metrics views yet. The finance views join this
-- table in a later phase; until then it is a mirror that can be rebuilt from
-- the gateways at any time.

-- ============================================================================
-- basket_payment_fees
-- Grain: one row per gateway transaction, keyed the way the gateway keys it.
--
-- Deliberately NOT keyed by basket_payments.id and NOT foreign-keyed to it.
-- The gateways are the upstream: they answer with transactions this mirror may
-- not have ingested yet (or may never ingest — a Pago whose Subscriber is
-- unknown is skipped on upload). Keying by (platform, platform_payment_id)
-- lets the backfill run independently of payment ingestion, and lets a fee row
-- arrive before its Pago. The join back into basket_payments is by that same
-- pair, which basket_payments_platform_payment_id_idx below supports.
--
-- Two currency planes, kept separate on purpose:
--   * PRESENTMENT — what the subscriber was charged. currency + gross_amount.
--     Matches basket_payments.currency / .amount, so it is the reconciliation
--     plane.
--   * SETTLEMENT — what the gateway actually moved into the account, after its
--     own conversion. settlement_currency + settlement_amount + fee_amount +
--     net_amount. Fees only exist in this plane; a fee expressed in the
--     presentment currency would be a derived number, so it is not stored.
--
-- exchange_rate is presentment -> settlement as the gateway applied it on the
-- day of the charge. Stripe reports it per balance transaction; MercadoPago
-- settles ARS into ARS and reports none, so it is NULL there and the plane
-- collapses (settlement_currency = currency). Converting ARS to USD is a
-- separate concern with a separate source (the blue-rate table) and does not
-- belong in a mirror of what the gateway said.
-- ============================================================================
CREATE TABLE IF NOT EXISTS basket_payment_fees (
  platform            SMALLINT       NOT NULL,
  platform_payment_id TEXT           NOT NULL,
  gross_amount        NUMERIC(14, 2) NOT NULL,
  currency            VARCHAR(10)    NOT NULL,
  fee_amount          NUMERIC(14, 2) NOT NULL,
  net_amount          NUMERIC(14, 2) NOT NULL,
  settlement_currency VARCHAR(10)    NOT NULL,
  settlement_amount   NUMERIC(14, 2) NOT NULL,
  exchange_rate       NUMERIC(20, 10),
  refunded_amount     NUMERIC(14, 2) NOT NULL DEFAULT 0,
  gateway_status      TEXT,
  captured_at         TIMESTAMPTZ,
  synced_at           TIMESTAMPTZ    NOT NULL DEFAULT NOW(),
  CONSTRAINT basket_payment_fees_platform_platform_payment_id_pk
    PRIMARY KEY (platform, platform_payment_id)
);

-- The backfill walks time windows and re-runs them; captured_at is how a window
-- is re-checked and how the finance views will bucket fees by month.
CREATE INDEX IF NOT EXISTS basket_payment_fees_captured_at_idx
  ON basket_payment_fees(captured_at);

-- ============================================================================
-- Join support on the payments side.
-- basket_payments is keyed by the Platform's own id; platform_payment_id had no
-- index, so joining 430k fee rows back to Pagos was a sequential scan per query.
-- Partial: rows without a gateway id (Manual, Voucher, Antel) can never join.
-- ============================================================================
CREATE INDEX IF NOT EXISTS basket_payments_platform_payment_id_idx
  ON basket_payments(platform, platform_payment_id)
  WHERE platform_payment_id IS NOT NULL;
