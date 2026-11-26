-- basket_v_cashflow_available, Stripe half: which payout carried a balance
-- transaction is deduced, not read. See docs/adr/0009-cashflow-reads-published-views.md.
--
-- Idempotent: CREATE OR REPLACE VIEW with 0028's columns. Grants survive.
--
--   docker exec -i data-bp-postgres-1 psql -U basket -d basket_analytics -v ON_ERROR_STOP=1 \
--     < migrations/sql/0029_cashflow_available_by_sweep.sql
--
-- Why: 0028 tagged each transaction with its payout through Stripe's
-- `balance_transactions?payout=`, which answers only for automatic payouts.
-- This account pays out by hand, and every manual payout sweeps the whole
-- available balance. So a transaction rides the first paid payout of its
-- currency created once it was available. A failed payout's money comes back
-- and rides the next paid one, which the same rule gives. Cashflow checks that
-- each credit day adds up before trusting it, so a payout that did not sweep
-- shows up there instead of moving money between days silently.
--
-- The `payout-ledger` sync now lists every balance transaction by creation
-- (payout_id stays null). Backfill from before the first payout to re-date:
--
--   pnpm backfill:stripe-ledger --from=2026-07-15 --only=payouts,payout-ledger
CREATE OR REPLACE VIEW basket_v_cashflow_available AS
SELECT
  m.platform,
  (m.available_at AT TIME ZONE 'UTC')::date AS available_date,
  (p.arrival_date AT TIME ZONE 'UTC')::date AS credit_date,
  p.currency,
  SUM(m.net_amount)::numeric(14, 2) AS amount
FROM basket_gateway_movements m
CROSS JOIN LATERAL (
  SELECT q.arrival_date, q.currency
  FROM basket_gateway_payouts q
  WHERE q.platform = m.platform
    AND q.status = 'paid'
    AND q.arrival_date IS NOT NULL
    AND UPPER(q.currency) = m.currency
    AND q.created_at >= m.available_at
  ORDER BY q.created_at
  LIMIT 1
) p
WHERE m.platform = 4
  AND m.available_at IS NOT NULL
  AND m.type NOT LIKE 'payout%'
GROUP BY m.platform, 2, 3, p.currency
UNION ALL
SELECT platform, credit_date AS available_date, credit_date, currency, amount
FROM basket_v_cashflow_credits
WHERE platform = 0;
