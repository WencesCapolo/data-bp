-- Phase 17: the FX plane. One table of daily rates, keyed by the source that
-- produced each one. See docs/adr/0007-fx-rates-name-their-source.md.
--
-- Idempotent: CREATE ... IF NOT EXISTS. Safe to re-run.
--
--   psql "$DATABASE_URL" -v ON_ERROR_STOP=1 -f migrations/sql/0017_fx_rates.sql
--
-- Every figure on /financiero is denominated in a Provider's own currency
-- because nothing here could convert them: MercadoPago settles ARS, Stripe
-- settles USD and EUR, and adding them needed a rate this schema did not hold.
-- This table holds it.
--
-- WHY `source` IS PART OF THE KEY. Two rates for the same day are both correct
-- and they disagree. Stripe converted a UYU charge at its own rate on the day it
-- captured it — that rate is already in basket_payment_fees.exchange_rate, it is
-- the rate the money actually moved at, and it is what a Stripe figure must
-- reconcile against to the cent. The blue rate is what an ARS figure must
-- convert at, because MercadoPago settles ARS into ARS and reports no rate at
-- all. A table that could not say which of the two produced a number could not
-- answer the question the tab asks, so the source is in the primary key rather
-- than in a comment.
--
-- DIRECTION. `rate` is quote units per one base unit, always, and the pair is
-- read off the key rather than assumed:
--
--     (USD, ARS, 'blue')  rate 1565.00  -> 1565 ARS buys 1 USD; ARS/1565 = USD
--     (UYU, USD, 'stripe') rate 0.0256  -> 1 UYU settled as 0.0256 USD
--
-- so converting is `amount * rate` when the amount is in `base_currency` and
-- `amount / rate` when it is in `quote_currency`. Nothing infers a direction
-- from the magnitude.
CREATE TABLE IF NOT EXISTS basket_fx_rates (
  day            DATE           NOT NULL,
  base_currency  VARCHAR(10)    NOT NULL,
  quote_currency VARCHAR(10)    NOT NULL,
  -- 'blue'   — dolarapi's informal ARS market, daily history from
  --            api.argentinadatos.com. Every calendar day is present, weekends
  --            carrying the previous close, so a missing day means the feed
  --            broke rather than that the market was shut.
  -- 'stripe' — DERIVED, not fetched: the volume-weighted rate Stripe itself
  --            applied that day, read back out of basket_payment_fees. It exists
  --            so a converted Stripe figure can name the rate that produced it;
  --            per-row conversion still uses the row's own exchange_rate, which
  --            is the only thing that reconciles to the cent.
  source         TEXT           NOT NULL,
  rate           NUMERIC(20, 10) NOT NULL,
  -- The other side of the spread, carried but not used. dolarapi reports compra
  -- and venta ~1.3% apart; revenue arriving is a sale of dollars, so `rate`
  -- holds venta and this column exists only so the choice can be audited
  -- without re-fetching five thousand days.
  buy_rate       NUMERIC(20, 10),
  synced_at      TIMESTAMPTZ    NOT NULL DEFAULT NOW(),
  CONSTRAINT basket_fx_rates_pk PRIMARY KEY (day, base_currency, quote_currency, source)
);

COMMENT ON TABLE basket_fx_rates IS
  'Daily FX rates, one row per (day, pair, source). rate = quote units per 1 base unit. See docs/adr/0007.';
COMMENT ON COLUMN basket_fx_rates.rate IS
  'Quote per base. For the blue source this is dolarapi venta (the sell side), because revenue arriving is a sale of dollars.';
COMMENT ON COLUMN basket_fx_rates.buy_rate IS
  'The compra side of the same quote, or NULL where the source reports one price. Never used in a conversion.';
COMMENT ON COLUMN basket_fx_rates.source IS
  'blue = dolarapi informal ARS market; stripe = derived from basket_payment_fees.exchange_rate. Part of the key: two sources for one day are both correct and disagree.';

-- The lookup every conversion makes: a pair and a source over a range of days.
CREATE INDEX IF NOT EXISTS basket_fx_rates_pair_idx
  ON basket_fx_rates(base_currency, quote_currency, source, day);
