-- basket_v_cashflow_released: what Stripe released each day, whether or not a
-- payout has swept it yet. See docs/adr/0009-cashflow-reads-published-views.md.
--
-- Idempotent: CREATE OR REPLACE VIEW. Safe to re-run.
--
--   pnpm sql:apply migrations/sql/0031_cashflow_released.sql
--
-- Why: finance counts gateway income on the day it was released in the
-- gateway (cashflow-bp#281). basket_v_cashflow_available only has what a paid
-- payout already swept, and this account pays out by hand about twice a week,
-- so a released day could reach cashflow a week late and split across two
-- payouts. The payout-ledger sync already stores every balance transaction
-- with its available_on, swept or not, so no new sync and no backfill.

-- ============================================================================
-- basket_v_cashflow_released
-- Grain: one row per (platform, available_date, currency). Stripe only:
-- MercadoPago releases straight into the account, and its credit day is
-- already its release day.
--
--   available_date  the transaction's available_on, in UTC as Stripe stamps it.
--   currency        the balance it settled into (USD or EUR).
--   amount          the net of every balance transaction that became available
--                   that day: charges net of Stripe's fee, refunds, disputes,
--                   Stripe's own fees and adjustments. The payouts' own
--                   movements are left out, as in basket_v_cashflow_available.
--
-- A day is complete once the payout-ledger sync ran after it ended (its row in
-- basket_v_cashflow_freshness). Rows for future days are releases Stripe has
-- already scheduled; cashflow ignores them until the day has passed.
-- ============================================================================
CREATE OR REPLACE VIEW basket_v_cashflow_released AS
SELECT
  m.platform,
  (m.available_at AT TIME ZONE 'UTC')::date AS available_date,
  m.currency,
  SUM(m.net_amount)::numeric(14, 2) AS amount
FROM basket_gateway_movements m
WHERE m.platform = 4
  AND m.available_at IS NOT NULL
  AND m.type NOT LIKE 'payout%'
GROUP BY m.platform, 2, m.currency;

GRANT SELECT ON basket_v_cashflow_released TO cashflow_reader;
