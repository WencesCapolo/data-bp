-- basket_payment_fees.card_country takes the country the money came from, not
-- only a card's. See docs/adr/0009-cashflow-reads-published-views.md.
--
-- Idempotent: COMMENT ON. Safe to re-run.
--
--   pnpm sql:apply migrations/sql/0032_stripe_country_from_method.sql
--
-- Why: about a third of Stripe's sales are paid with Link, whose charge has no
-- `card` block, so 0030 left them without a country and in Internacional. Link
-- reports the country of the card beneath it as `link.country`. The fetcher
-- now reads the method's own country, else the billing address. Re-read the
-- fee mirror to fill the old rows:
--
--   pnpm backfill:stripe-card-country --from=2025-09-01 --only=fees
COMMENT ON COLUMN basket_payment_fees.card_country IS
  'ISO-2 country the money came from: the payment method''s (a card''s issuing bank, Link''s underlying card), else the billing address. NULL when Stripe names neither, and for MercadoPago.';
