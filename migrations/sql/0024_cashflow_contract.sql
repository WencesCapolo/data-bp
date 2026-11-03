-- What Analytics publishes to cashflow (cashflow.basket-app.com), and the only
-- thing cashflow may read. See docs/adr/0009-cashflow-reads-published-views.md.
--
-- Idempotent: CREATE OR REPLACE / IF NOT EXISTS. Safe to re-run.
--
--   psql "$DATABASE_URL" -v ON_ERROR_STOP=1 -f migrations/sql/0024_cashflow_contract.sql
--
-- THE THREE VIEWS ARE A CONTRACT. Cashflow's adapter reads these names and
-- columns; renaming or retyping one breaks it. Add columns freely, change none
-- without changing cashflow in step.
--
-- The role `cashflow_reader` is created WITHOUT a password and can do nothing
-- but SELECT these three views. The views run with their owner's rights, so the
-- role needs no grant on any table: it cannot read basket_payments (names and
-- emails) or anything else. The password is set by a human on each host:
--
--   ALTER ROLE cashflow_reader PASSWORD '…';

-- ============================================================================
-- basket_v_cashflow_credits
-- Grain: one row per credit — money a Provider made available to us.
--
--   Stripe (4)       one row per payout. credit_date is Stripe's arrival_date,
--                    the banking day it stamps at midnight UTC. Cashflow adds
--                    its own bank-value-date rule; this view states the fact.
--   MercadoPago (0)  one row per release day and currency: the net of every
--                    balance movement MP released that day, in Argentina time.
--                    payout_id is synthetic ('mp:YYYY-MM-DD:CUR') and stable.
--
-- status: Stripe's verbatim (paid, pending, in_transit, canceled, failed). For
-- MercadoPago, 'paid' once the day is over in Argentina, 'pending' otherwise —
-- a release day keeps growing until the next morning's ALLReport is ingested,
-- which is what basket_v_cashflow_freshness is for.
-- ============================================================================
CREATE OR REPLACE VIEW basket_v_cashflow_credits AS
SELECT
  p.platform,
  (p.arrival_date AT TIME ZONE 'UTC')::date AS credit_date,
  p.currency,
  p.amount,
  p.payout_id,
  p.status
FROM basket_gateway_payouts p
WHERE p.platform = 4
  AND p.arrival_date IS NOT NULL
UNION ALL
SELECT
  m.platform,
  d.credit_date,
  m.currency,
  SUM(m.net_amount)::numeric(14, 2) AS amount,
  'mp:' || d.credit_date::text || ':' || m.currency AS payout_id,
  CASE
    WHEN d.credit_date < (NOW() AT TIME ZONE 'America/Argentina/Buenos_Aires')::date THEN 'paid'
    ELSE 'pending'
  END AS status
FROM basket_gateway_movements m
CROSS JOIN LATERAL (
  SELECT (m.available_at AT TIME ZONE 'America/Argentina/Buenos_Aires')::date AS credit_date
) d
WHERE m.platform = 0
  AND m.available_at IS NOT NULL
GROUP BY m.platform, d.credit_date, m.currency;

-- ============================================================================
-- basket_v_cashflow_fx
-- Grain: one row per (day, pair, source). The rates cashflow converts with.
-- Direction as in basket_fx_rates: `rate` is quote units per one base unit, so
-- (USD, EUR, 'oficial_cross') is EUR per USD and EUR → USD is amount / rate.
-- Cashflow averages them itself; the averaging rule is its decision, not ours.
-- ============================================================================
CREATE OR REPLACE VIEW basket_v_cashflow_fx AS
SELECT day, base_currency, quote_currency, source, rate
FROM basket_fx_rates
WHERE source IN ('oficial_cross', 'blue');

-- ============================================================================
-- basket_v_cashflow_freshness
-- Grain: one row per feed cashflow depends on. last_data_at is when that feed
-- last brought data in; cashflow refuses to register credits from a stale one.
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
WHERE s.source = 'fx:oficial_cross';

-- ============================================================================
-- cashflow_reader
-- ============================================================================
DO $$
BEGIN
  IF NOT EXISTS (SELECT FROM pg_roles WHERE rolname = 'cashflow_reader') THEN
    CREATE ROLE cashflow_reader LOGIN;
  END IF;
  EXECUTE format('GRANT CONNECT ON DATABASE %I TO cashflow_reader', current_database());
END
$$;

GRANT USAGE ON SCHEMA public TO cashflow_reader;
GRANT SELECT ON basket_v_cashflow_credits, basket_v_cashflow_fx, basket_v_cashflow_freshness
  TO cashflow_reader;
