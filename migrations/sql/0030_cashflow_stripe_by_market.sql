-- Stripe's net split by the country of the card that paid, published to
-- cashflow. See docs/adr/0009-cashflow-reads-published-views.md.
--
-- Idempotent: ADD COLUMN IF NOT EXISTS, CREATE OR REPLACE VIEW. Safe to re-run.
--
--   pnpm sql:apply migrations/sql/0030_cashflow_stripe_by_market.sql
--
-- The column fills as the fee sync re-reads the ledger, and the movements learn
-- their Pago as the payout-ledger sync does. Both, from the agreed start:
--
--   pnpm backfill:stripe-card-country --from=2025-09-01

-- ISO-2 country of the bank that issued the card. Null for anything not paid
-- by card, and for every MercadoPago row.
ALTER TABLE basket_payment_fees ADD COLUMN IF NOT EXISTS card_country VARCHAR(2);

-- ============================================================================
-- basket_v_cashflow_stripe_by_market
-- Grain: one row per (month, market).
--
--   month    'YYYY-MM' of available_on, the day Stripe released the money, in
--            UTC as Stripe stamps it.
--   market   the card's country when it is one of cashflow's six; anything
--            else, a card Stripe reports no country for, or a charge the fee
--            mirror has not read yet, is 'Internacional'.
--   net_usd  the net after Stripe's fee of what settled into the USD balance.
--   net_eur  the same for the EUR balance: Stripe settles EUR charges in EUR,
--            and converting them is cashflow's call, as for its EUR payouts.
--
-- Charges, and the refunds that reverse them, each on the day its own money
-- moved, so a refund lands in the month it left. A refund takes the country of
-- the charge it reverses: both name the same Pago. Disputes, Stripe's own fees
-- and adjustments are no sale and are left out.
-- ============================================================================
CREATE OR REPLACE VIEW basket_v_cashflow_stripe_by_market AS
SELECT
  to_char(m.available_at AT TIME ZONE 'UTC', 'YYYY-MM') AS month,
  CASE f.card_country
    WHEN 'AR' THEN 'Argentina'
    WHEN 'UY' THEN 'Uruguay'
    WHEN 'CL' THEN 'Chile'
    WHEN 'EC' THEN 'Ecuador'
    WHEN 'BO' THEN 'Bolivia'
    WHEN 'BR' THEN 'Brasil'
    ELSE 'Internacional'
  END AS market,
  COALESCE(SUM(m.net_amount) FILTER (WHERE m.currency = 'USD'), 0)::numeric(14, 2) AS net_usd,
  COALESCE(SUM(m.net_amount) FILTER (WHERE m.currency = 'EUR'), 0)::numeric(14, 2) AS net_eur
FROM basket_gateway_movements m
LEFT JOIN basket_payment_fees f
  ON f.platform = m.platform
 AND f.platform_payment_id = m.platform_payment_id
WHERE m.platform = 4
  AND m.available_at IS NOT NULL
  AND m.type IN ('charge', 'payment', 'refund', 'payment_refund', 'refund_failure')
GROUP BY 1, 2;

GRANT SELECT ON basket_v_cashflow_stripe_by_market TO cashflow_reader;
