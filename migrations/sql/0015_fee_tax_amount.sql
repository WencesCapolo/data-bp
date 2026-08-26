-- Phase 15: tax withholding as its own column on the fee mirror.
--
-- Idempotent: ADD COLUMN IF NOT EXISTS. Safe to re-run.
--
--   psql "$DATABASE_URL" -v ON_ERROR_STOP=1 -f migrations/sql/0015_fee_tax_amount.sql
--
-- MercadoPago forced this. Its Cobros Export reports a commission
-- (`mercadopago_fee`) that is a flat 1.8% of the charge, and a
-- `net_received_amount` that is 7.3% below the gross. The difference — 5.1%,
-- 7.6% or 9.6% depending on the row — is tax withheld at source (retenciones),
-- and the Export gives it no column at all: it only appears as the gap.
--
-- Measured over July 2024, 10,056 Pagos: gross 75,011,659.00 ARS, commission
-- 1,350,189.76 (1.80%), withholding 4,135,643.02 (5.51%), net 69,525,826.22.
--
-- Folding the withholding into fee_amount would have been simpler and would
-- have made the arithmetic close, but it would report MercadoPago as costing
-- 7.3% against Stripe's 2-3% — a comparison that is wrong in kind, not just in
-- degree. A commission is spent. A withholding is a credit against tax owed and
-- comes back. They are not the same money and must not share a column.
--
-- The invariant this restores, and which every consumer may rely on:
--
--     gross_amount - fee_amount - COALESCE(tax_amount, 0) = net_amount
--
-- NULL, not 0, is the default. Stripe reports no withholding because there is
-- none to report, and 0 would claim we know that; NULL says the gateway never
-- spoke to the question. Sum it with COALESCE.
ALTER TABLE basket_payment_fees ADD COLUMN IF NOT EXISTS tax_amount NUMERIC(14, 2);

COMMENT ON COLUMN basket_payment_fees.tax_amount IS
  'Tax withheld at source by the gateway, in the SETTLEMENT plane, or NULL where the gateway reports none. gross - fee - COALESCE(tax,0) = net.';
