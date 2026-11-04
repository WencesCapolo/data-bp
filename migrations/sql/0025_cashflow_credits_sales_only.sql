-- basket_v_cashflow_credits, MercadoPago rows: count only what the sales
-- released, not what was spent from the MP balance. See
-- docs/adr/0009-cashflow-reads-published-views.md.
--
-- Idempotent: CREATE OR REPLACE with the same columns. Grants survive.
--
--   psql "$DATABASE_URL" -v ON_ERROR_STOP=1 -f migrations/sql/0025_cashflow_credits_sales_only.sql
--
-- Why: a payment made with the MP balance (a purchase at a merchant, paid with
-- `available_money`, plus the payer's tax withholding) and the loose debits MP
-- takes from the balance come in the ALLReport as SETTLEMENT rows with a
-- negative net. They are expenses, not reversed income, and the company types
-- them into its cashflow Excel as expenses already. Netting them into the day's
-- credit counted them twice. Refunds and chargebacks stay: they reverse sales,
-- and the hand-typed figure this replaces nets them too.
--
-- Only the MercadoPago half changes; the Stripe half is 0024's, verbatim.
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
  -- Spent from the balance: an expense the Excel already carries.
  AND NOT (m.type = 'SETTLEMENT' AND m.net_amount < 0)
GROUP BY m.platform, d.credit_date, m.currency;
