-- The credits of basket_v_cashflow_credits broken down by the day each sale was
-- made, published to cashflow. See docs/adr/0009-cashflow-reads-published-views.md.
--
-- Idempotent: ADD COLUMN / CREATE INDEX IF NOT EXISTS, CREATE OR REPLACE VIEW.
-- Safe to re-run.
--
--   psql "$DATABASE_URL" -v ON_ERROR_STOP=1 -f migrations/sql/0028_cashflow_sales.sql
--
-- The Stripe half reads the balance transactions each paid payout carried,
-- which the `payout-ledger` sync writes into basket_gateway_movements with the
-- payout's id. Their first load is a backfill:
--
--   pnpm backfill:stripe-ledger --from=2026-08-01 --only=payouts,payout-ledger

-- The Stripe payout that carried the movement to the bank. Null for MercadoPago.
ALTER TABLE basket_gateway_movements ADD COLUMN IF NOT EXISTS payout_id TEXT;

CREATE INDEX IF NOT EXISTS basket_gateway_movements_payout_id_idx
  ON basket_gateway_movements(payout_id);

-- ============================================================================
-- basket_v_cashflow_sales
-- Grain: one row per (platform, sale_date, credit_date, currency).
--
-- For every (platform, credit_date, currency), SUM(amount) over its sale_dates
-- equals that credit's amount in basket_v_cashflow_credits: the same rows,
-- filtered the same way, only also grouped by when the money was generated.
--
--   Stripe (4)       the balance transactions of each paid payout, the
--                    payout's own debit left out. Their nets add up to the
--                    payout's amount, sign included: charges in, refunds,
--                    fees and disputes out. credit_date is the payout's
--                    arrival_date, sale_date the transaction's creation, both
--                    in UTC as Stripe stamps them.
--   MercadoPago (0)  the movements of 0025's MP credit, with its filter.
--                    sale_date is the ALLReport's TRANSACTION_DATE in Argentina
--                    time, or the release day when it has none.
-- ============================================================================
CREATE OR REPLACE VIEW basket_v_cashflow_sales AS
SELECT
  m.platform,
  (m.occurred_at AT TIME ZONE 'UTC')::date AS sale_date,
  (p.arrival_date AT TIME ZONE 'UTC')::date AS credit_date,
  p.currency,
  SUM(m.net_amount)::numeric(14, 2) AS amount
FROM basket_gateway_movements m
JOIN basket_gateway_payouts p
  ON p.platform = m.platform
 AND p.payout_id = m.payout_id
WHERE m.platform = 4
  AND p.status = 'paid'
  AND p.arrival_date IS NOT NULL
GROUP BY m.platform, 2, 3, p.currency
UNION ALL
SELECT
  m.platform,
  COALESCE((m.occurred_at AT TIME ZONE 'America/Argentina/Buenos_Aires')::date, d.credit_date) AS sale_date,
  d.credit_date,
  m.currency,
  SUM(m.net_amount)::numeric(14, 2) AS amount
FROM basket_gateway_movements m
CROSS JOIN LATERAL (
  SELECT (m.available_at AT TIME ZONE 'America/Argentina/Buenos_Aires')::date AS credit_date
) d
WHERE m.platform = 0
  AND m.available_at IS NOT NULL
  AND NOT (m.type = 'SETTLEMENT' AND m.net_amount < 0)
GROUP BY m.platform, 2, d.credit_date, m.currency;

GRANT SELECT ON basket_v_cashflow_sales TO cashflow_reader;

-- ============================================================================
-- basket_v_cashflow_freshness, plus `stripe:sales`: when the payout ledger
-- last synced clean. 0027's four feeds, verbatim.
-- ============================================================================
CREATE OR REPLACE VIEW basket_v_cashflow_freshness AS
SELECT 'stripe:payouts'::text AS feed, s.last_sync AS last_data_at
FROM basket_sync_state s
WHERE s.source = 'payouts:stripe'
UNION ALL
SELECT 'mercadopago:movements', MAX(m.synced_at)
FROM basket_gateway_movements m
WHERE m.platform = 0
UNION ALL
SELECT 'fx:oficial_cross', s.last_sync
FROM basket_sync_state s
WHERE s.source = 'fx:oficial_cross'
UNION ALL
SELECT 'pagos:upload', s.last_sync
FROM basket_sync_state s
WHERE s.source = 'payments'
UNION ALL
SELECT 'stripe:sales', s.last_sync
FROM basket_sync_state s
WHERE s.source = 'payout-ledger:stripe';
