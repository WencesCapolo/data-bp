-- Plan prices and Stripe's rates, published to cashflow. See
-- docs/adr/0009-cashflow-reads-published-views.md.
--
-- Idempotent: views only, recreated with their grants. Safe to re-run.
--
--   psql "$DATABASE_URL" -v ON_ERROR_STOP=1 -f migrations/sql/0027_cashflow_plan_prices_and_fx.sql
--
-- Cashflow's PyG shows, next to each plan, the price it is charged at today,
-- and the monthly price of the dollar in each local currency.

-- ============================================================================
-- basket_v_cashflow_plan_prices
-- Grain: one row per (country, currency, plan) charged in the 30 days up to the
-- anchor of basket_mat_cashflow_subscribers (the last Pago day, at most
-- yesterday).
--
-- price          the amount most real Pagos of that plan were charged at in
--                those days: the list price, not an average that coupons and
--                refunds would pull down. Ties go to the latest charged.
-- charges        how many Pagos were charged at that price.
-- last_charged   the last day one was.
--
-- A plain view: the fact table is indexed on created_at and the window is 30
-- days.
-- ============================================================================
CREATE OR REPLACE VIEW basket_v_cashflow_plan_prices AS
WITH anchor AS (
  SELECT LEAST(MAX(created_at)::date, CURRENT_DATE - 1) AS d
  FROM basket_mat_payment_facts
),
charged AS (
  SELECT f.country, f.ccy AS currency, f.sub_type AS plan, f.amount,
         COUNT(*)::int            AS charges,
         MAX(f.created_at)::date  AS last_charged
  FROM basket_mat_payment_facts f, anchor a
  WHERE f.access_type = 'real'
    AND f.amount > 0
    AND f.sub_type IN ('Mensual_Basico', 'Mensual_Total', 'Anual_Total')
    AND f.created_at >= a.d - 29
    AND f.created_at <  a.d + 1
  GROUP BY 1, 2, 3, 4
)
SELECT DISTINCT ON (country, currency, plan)
       country, currency, plan, amount AS price, charges, last_charged
FROM charged
ORDER BY country, currency, plan, charges DESC, last_charged DESC;

GRANT SELECT ON basket_v_cashflow_plan_prices TO cashflow_reader;

-- ============================================================================
-- basket_v_cashflow_fx, plus the rates Stripe applied (source 'stripe'): one
-- per day and presentment currency, settlement units per presentment unit,
-- weighted by gross (DrizzleFxRateRepository.refreshDerivedStripeRates). They
-- are the only quote this app has for the currencies that are neither ARS nor
-- EUR. Cashflow averages them by month itself.
-- ============================================================================
CREATE OR REPLACE VIEW basket_v_cashflow_fx AS
SELECT day, base_currency, quote_currency, source, rate
FROM basket_fx_rates
WHERE source IN ('oficial_cross', 'blue', 'stripe');
