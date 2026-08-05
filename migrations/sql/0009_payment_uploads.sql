-- Phase 11: Cobros Export uploads — provenance table + price-tier fallback data.
-- See docs/adr/0003 (tier from price lookup table), docs/adr/0004 (who may upload).
-- Idempotent: CREATE ... IF NOT EXISTS, seeds ON CONFLICT DO NOTHING. Safe to re-run.
--
-- This file creates TABLES ONLY. The `basket_v_active_payments` view that reads
-- basket_price_tiers lives in 0001_views.sql, which remains its single owner —
-- putting a second copy here would let `pnpm views:apply` silently revert the
-- tier fallback by recreating the view from the older definition.
--
-- Apply order matters: this file must run BEFORE 0001_views.sql, because the
-- view's LATERAL join references basket_price_tiers.
--
--   psql "$DATABASE_URL" -v ON_ERROR_STOP=1 -f migrations/sql/0009_payment_uploads.sql
--   pnpm views:apply
--   pnpm views:refresh

-- ============================================================================
-- 1. basket_payment_uploads
-- One row per confirmed Cobros Export upload: who, what file, what window,
-- how many rows survived. Provenance only — never read by the metrics views.
-- ============================================================================
CREATE TABLE IF NOT EXISTS basket_payment_uploads (
  id            SERIAL PRIMARY KEY,
  uploaded_by   TEXT        NOT NULL,
  filename      TEXT        NOT NULL,
  byte_size     INTEGER     NOT NULL,
  row_total     INTEGER     NOT NULL,
  rows_ingested INTEGER     NOT NULL,
  rows_skipped  INTEGER     NOT NULL,
  window_from   TIMESTAMPTZ,
  window_to     TIMESTAMPTZ,
  error         TEXT,
  created_at    TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS basket_payment_uploads_created_at_idx
  ON basket_payment_uploads(created_at);

-- ============================================================================
-- 2. basket_price_tiers
-- Tier fallback for uploaded Cobros, which carry no price_id.
--
-- A PRICE BOOK of exact current price points, not a range or threshold model.
-- Ranges were tried and are provably wrong: checked against 510k rows that DO
-- carry a real price_id, a threshold model scored 61.3 pct on ars and 2.4 pct
-- on clp. The reason is ARS inflation - today's Mensual_Basico price (16999)
-- sits ABOVE yesterday's Mensual_Total prices, so amount alone cannot identify
-- a Tier across time. Within a single recent year it can: every price point
-- below is 100 pct unanimous among 2026 rows.
--
-- Rows were mined from labelled data, not guessed:
--   status=1, recurrent=30, amount>0, created_at >= 2026-01-01,
--   grouped by (currency, amount), keeping points with >=99 pct tier purity and
--   >=30 observations. Measured on that same population: 98.76 pct of rows match
--   a price point, and 101371/101373 of those get the same Tier price_id says.
--
-- Monthly (recurrent = 30) only - the view resolves 365 -> Anual_Total and
-- 0 -> Free without ever consulting price.
--
-- Currency is stored LOWERCASE here; basket_payments.currency is UPPERCASE
-- (the mapper uppercases it), so the view lowers it before joining.
--
-- WHEN PRICING CHANGES this table must gain the new price points, or Cobros at
-- the new price silently classify as 'Otros'. Unmatched points are surfaced as
-- an `unmapped_price_points` warning on upload, which is the signal that this
-- table has gone stale.
-- ============================================================================
CREATE TABLE IF NOT EXISTS basket_price_tiers (
  currency   VARCHAR(10)    NOT NULL,
  recurrent  SMALLINT       NOT NULL,
  amount     NUMERIC(14, 2) NOT NULL,
  sub_type   TEXT           NOT NULL,
  note       TEXT,
  -- constraint name matches what drizzle-kit push generates for this composite PK,
  -- so `pnpm db:push` sees no diff whichever ran first
  CONSTRAINT basket_price_tiers_currency_recurrent_amount_pk
    PRIMARY KEY (currency, recurrent, amount)
);

INSERT INTO basket_price_tiers (currency, recurrent, amount, sub_type, note) VALUES
  ('ars', 30, 16999.00, 'Mensual_Basico', '50985 rows in 2026, 100.0% pure'),
  ('ars', 30, 12999.00, 'Mensual_Total', '14997 rows in 2026, 100.0% pure'),
  ('bob', 30, 69.00, 'Mensual_Basico', '95 rows in 2026, 100.0% pure'),
  ('bob', 30, 59.99, 'Mensual_Total', '41 rows in 2026, 100.0% pure'),
  ('brl', 30, 34.99, 'Mensual_Basico', '882 rows in 2026, 100.0% pure'),
  ('brl', 30, 19.99, 'Mensual_Total', '422 rows in 2026, 100.0% pure'),
  ('clp', 30, 10999.00, 'Mensual_Basico', '4923 rows in 2026, 100.0% pure'),
  ('clp', 30, 9899.00, 'Mensual_Basico', '305 rows in 2026, 100.0% pure'),
  ('clp', 30, 7999.00, 'Mensual_Total', '4217 rows in 2026, 100.0% pure'),
  ('clp', 30, 1900.00, 'Mensual_Basico', '60 rows in 2026, 100.0% pure'),
  ('eur', 30, 12.99, 'Mensual_Basico', '363 rows in 2026, 100.0% pure'),
  ('eur', 30, 9.99, 'Mensual_Total', '112 rows in 2026, 100.0% pure'),
  ('pen', 30, 41.00, 'Mensual_Basico', '104 rows in 2026, 100.0% pure'),
  ('usd', 30, 12.99, 'Mensual_Basico', '2384 rows in 2026, 100.0% pure'),
  ('usd', 30, 10.99, 'Mensual_Basico', '913 rows in 2026, 100.0% pure'),
  ('usd', 30, 9.99, 'Mensual_Total', '813 rows in 2026, 100.0% pure'),
  ('usd', 30, 8.99, 'Mensual_Basico', '58 rows in 2026, 100.0% pure'),
  ('usd', 30, 8.79, 'Mensual_Basico', '58 rows in 2026, 100.0% pure'),
  ('usd', 30, 8.00, 'Mensual_Basico', '112 rows in 2026, 100.0% pure'),
  ('uyu', 30, 599.00, 'Mensual_Basico', '13441 rows in 2026, 100.0% pure'),
  ('uyu', 30, 449.00, 'Mensual_Total', '6088 rows in 2026, 100.0% pure')
ON CONFLICT (currency, recurrent, amount) DO NOTHING;
