-- Subscribers by month and country, published to cashflow. See
-- docs/adr/0009-cashflow-reads-published-views.md.
--
-- Idempotent: drop, then recreate; the published view and its grant are
-- recreated with it. Safe to re-run.
--
--   psql "$DATABASE_URL" -v ON_ERROR_STOP=1 -f migrations/sql/0026_cashflow_subscribers.sql
--
-- Cashflow's PyG compares, per month and country, the real Subscribers against
-- the forecast of its budget Excel. It reads counts only: no amounts, no user
-- ids, no names. Cashflow groups the raw country into its own seven countries
-- plus the rest; that grouping is its decision, not ours.

DROP MATERIALIZED VIEW IF EXISTS basket_mat_cashflow_subscribers CASCADE;

-- ============================================================================
-- basket_mat_cashflow_subscribers
-- Grain: one row per (month, country) with a Subscriber active at its close or
-- a charged Pago in it, from the month of the first Pago to the month of the
-- anchor.
--
-- The anchor is the last Pago day, at most yesterday: Pagos arrive by Upload,
-- so the days after the last one hold every scheduled expiry and no renewal
-- (the same anchor as basket_mat_subscriber_months, migration 0019). A month is
-- measured at its last day, or at the anchor for the month in progress, which
-- is then `partial`.
--
-- active_at_close       Subscribers in the pool on the close day, by the one
--                       rule: some successful Pago has
--                       created_at ≤ day ≤ expires_at + 7 days.
-- active_paid_at_close  the same, counting only access_type 'real' Pagos.
-- charged_transactions  successful Pagos with amount > 0 created in the month.
--
-- Materialized because the active count joins every Pago to every month; it is
-- refreshed with the rest at the end of every Sync and Upload (matViewOrder.ts),
-- and cashflow cuts its queries at 10 s.
-- ============================================================================
CREATE MATERIALIZED VIEW basket_mat_cashflow_subscribers AS
WITH anchor AS (
  SELECT LEAST(MAX(created_at)::date, CURRENT_DATE - 1) AS d,
         DATE_TRUNC('month', MIN(created_at))::date      AS first_month
  FROM basket_mat_payment_facts
),
months AS (
  SELECT m.month,
         LEAST(m.last_day, a.d) AS close_day,
         m.last_day > a.d       AS partial
  FROM anchor a
  CROSS JOIN LATERAL (
    SELECT g::date AS month, (g + INTERVAL '1 month' - INTERVAL '1 day')::date AS last_day
    FROM generate_series(a.first_month, DATE_TRUNC('month', a.d), INTERVAL '1 month') AS g
  ) m
),
active AS (
  SELECT mo.month, f.country,
         COUNT(DISTINCT f.user_id)::int                                         AS active_at_close,
         COUNT(DISTINCT f.user_id) FILTER (WHERE f.access_type = 'real')::int   AS active_paid_at_close
  FROM months mo
  JOIN basket_mat_payment_facts f
    ON f.created_at::date <= mo.close_day
   AND (f.expires_at + INTERVAL '7 days')::date >= mo.close_day
  GROUP BY mo.month, f.country
),
charged AS (
  SELECT f.month, f.country, COUNT(*)::int AS charged_transactions
  FROM basket_mat_payment_facts f
  JOIN months mo ON mo.month = f.month
  WHERE f.amount > 0
  GROUP BY f.month, f.country
),
cells AS (
  SELECT month, country FROM active
  UNION
  SELECT month, country FROM charged
)
SELECT c.month,
       c.country,
       COALESCE(a.active_at_close, 0)       AS active_at_close,
       COALESCE(a.active_paid_at_close, 0)  AS active_paid_at_close,
       COALESCE(ch.charged_transactions, 0) AS charged_transactions,
       mo.partial
FROM cells c
JOIN months mo ON mo.month = c.month
LEFT JOIN active a   ON a.month = c.month AND a.country = c.country
LEFT JOIN charged ch ON ch.month = c.month AND ch.country = c.country;

-- Unique, so the Sync can refresh it CONCURRENTLY like the others.
CREATE UNIQUE INDEX basket_mat_cashflow_subscribers_month_country_idx
  ON basket_mat_cashflow_subscribers(month, country);

-- ============================================================================
-- basket_v_cashflow_subscribers
-- What cashflow reads. A contract like the views of 0024: add columns freely,
-- rename or retype none without changing cashflow in step.
-- ============================================================================
CREATE OR REPLACE VIEW basket_v_cashflow_subscribers AS
SELECT month, country, active_at_close, active_paid_at_close, charged_transactions, partial
FROM basket_mat_cashflow_subscribers;

GRANT SELECT ON basket_v_cashflow_subscribers TO cashflow_reader;

-- ============================================================================
-- basket_v_cashflow_freshness, plus the Pagos feed: when the last Upload
-- without error came in. 0024's three feeds, verbatim.
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
SELECT 'pagos:upload', MAX(u.created_at)
FROM basket_payment_uploads u
WHERE u.error IS NULL;
