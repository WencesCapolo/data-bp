-- The Provider account's balance movements, one row per movement, dated by when
-- the money is released. MercadoPago's ALLReport only, today (data-bp#26).
--
-- Idempotent: CREATE ... IF NOT EXISTS. Safe to re-run.
--
--   psql "$DATABASE_URL" -v ON_ERROR_STOP=1 -f migrations/sql/0023_gateway_movements.sql
--
-- Not the fee mirror: basket_payment_fees folds an operation into one row and
-- dates it by capture ("what we earned"). This keeps every movement apart and
-- signed in the account frame (+ in, − out), so a refund leaves on its own day
-- and a commission invoice, which is no Pago at all, leaves too. It answers
-- "when did the money become ours", which is what cashflow reads.
--
-- A MIRROR in the sense of docs/adr/0005: rebuildable by re-ingesting the
-- Exports, never foreign-keyed to basket_payments.
CREATE TABLE IF NOT EXISTS basket_gateway_movements (
  platform            SMALLINT       NOT NULL,
  movement_id         TEXT           NOT NULL,
  platform_payment_id TEXT,
  type                TEXT           NOT NULL,
  currency            VARCHAR(10)    NOT NULL,
  net_amount          NUMERIC(14, 2) NOT NULL,
  occurred_at         TIMESTAMPTZ,
  available_at        TIMESTAMPTZ,
  synced_at           TIMESTAMPTZ    NOT NULL DEFAULT NOW(),
  CONSTRAINT basket_gateway_movements_platform_movement_id_pk
    PRIMARY KEY (platform, movement_id)
);

CREATE INDEX IF NOT EXISTS basket_gateway_movements_available_at_idx
  ON basket_gateway_movements(available_at);
