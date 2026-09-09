-- Net revenue anchored to Pagos, with the complement kept visible.
-- Apply with:
--
--   pnpm sql:apply migrations/sql/0020_gateway_net_pago_anchored.sql
--
-- Two materialized views, same grain (day × Provider × currency) and the same
-- two currency planes, partitioning the fee mirror exactly:
--
--   basket_mat_gateway_net_daily          fee rows whose Pago exists — a
--                                         successful Pago with the same Provider
--                                         and the same Provider payment id, whose
--                                         Subscriber is known. The headline.
--   basket_mat_gateway_net_outside_pagos  every other fee row. Money the gateway
--                                         account took that the Control Panel
--                                         never ledgered as a Pago: another
--                                         product sold through the same account,
--                                         or a Pagos Export not yet uploaded.
--
-- WHY THE JOIN (GitHub issue #5). Until this migration the headline summed the
-- mirror whole, and only the filtered path joined to Pagos — so toggling a
-- country filter changed the population, not just the slice. In months where
-- the MercadoPago account also charged for things that are not a basquetpass.tv
-- subscription, the unfiltered net was up to 50% too high (2026-02). Anchoring
-- every counted peso to a Pago is what makes fee → Pago → Subscriber → team a
-- complete chain; the second view is what keeps the difference from vanishing.
--
-- The two views must be refreshed AFTER basket_v_active_payments' dependents:
-- they now move when Pagos are ingested, not only when fees are.
--
-- CLOCK: captured_at, true UTC. basket_payments.created_at is Argentina local
-- time stored as UTC — a 3-hour skew. Nothing here reads created_at; the join
-- is on ids, never on dates.
--
-- SEAM: `WHERE platform IN (0, 4)` — MercadoPago and Stripe, the two Providers
-- whose fee mirror has rows. Kept as a whitelist: PayPal takes real money and
-- has no fee feed, so an un-gated view would render every PayPal transaction as
-- zero revenue — "cost us nothing" instead of "we do not know". Must agree with
-- GATEWAY_PLATFORMS in DrizzleAnalyticsQueryRepository.
--
-- TAX: `taxes` is MercadoPago's withholding at source (migration 0015). NOT part
-- of `fees`: a commission is spent, a withholding is a tax credit. The invariant
-- every consumer may rely on is gross - fees - taxes = net.
--
-- No FX here, by choice: basket_fx_rates is applied one layer up at DAY grain
-- (core/services/usdConversion.ts), so a refresh never freezes a rate.
--
-- Idempotent: drop, then recreate.

DROP MATERIALIZED VIEW IF EXISTS basket_mat_gateway_net_daily CASCADE;
DROP MATERIALIZED VIEW IF EXISTS basket_mat_gateway_net_outside_pagos CASCADE;

-- ============================================================================
-- basket_mat_gateway_net_daily — fee rows anchored to a Pago
-- Feeds: /financiero (Economía) — every unfiltered net figure, the hero's
--        30-day net USD pair, "Ingresos netos por mes".
-- ============================================================================
CREATE MATERIALIZED VIEW basket_mat_gateway_net_daily AS
WITH anchored AS (
  -- EXISTS rather than JOIN: a Pago id is unique in practice but not by
  -- constraint, and a duplicate would double a fee row. The predicate is the
  -- filtered path's `pay` CTE with the filter removed — the one definition of
  -- "belongs to a Pago", stated once here and once there, and they must agree.
  SELECT f.*
  FROM basket_payment_fees f
  WHERE f.platform IN (0, 4)
    AND f.captured_at IS NOT NULL
    AND EXISTS (
      SELECT 1 FROM basket_v_active_payments p
      WHERE p.platform = f.platform
        AND p.platform_payment_id = f.platform_payment_id
    )
),
settlement AS (
  SELECT
    'settlement'::text          AS grain,
    captured_at::date           AS day,
    platform                    AS platform,
    settlement_currency         AS ccy,
    SUM(settlement_amount)      AS gross,
    SUM(fee_amount)             AS fees,
    SUM(COALESCE(tax_amount,0)) AS taxes,
    SUM(net_amount)             AS net,
    COUNT(*)                    AS tx_count,
    0::numeric                  AS refunded,
    0::bigint                   AS refund_count
  FROM anchored
  GROUP BY captured_at::date, platform, settlement_currency
),
-- Presentment plane. refunded_amount lives next to the settlement columns but
-- is denominated in `currency`, not `settlement_currency` — the single easiest
-- thing to get wrong in this table.
refunds AS (
  SELECT
    'refund'::text              AS grain,
    captured_at::date           AS day,
    platform                    AS platform,
    currency                    AS ccy,
    0::numeric                  AS gross,
    0::numeric                  AS fees,
    0::numeric                  AS taxes,
    0::numeric                  AS net,
    0::bigint                   AS tx_count,
    SUM(refunded_amount)        AS refunded,
    COUNT(*)                    AS refund_count
  FROM anchored
  WHERE refunded_amount <> 0
  GROUP BY captured_at::date, platform, currency
)
SELECT * FROM settlement
UNION ALL
SELECT * FROM refunds;

-- REFRESH ... CONCURRENTLY needs a unique index; the grain discriminator is
-- part of the key because the same (day, platform, ccy) can appear in both.
CREATE UNIQUE INDEX basket_mat_gateway_net_daily_pk_idx
  ON basket_mat_gateway_net_daily(grain, day, platform, ccy);
CREATE INDEX basket_mat_gateway_net_daily_day_idx
  ON basket_mat_gateway_net_daily(day);

-- ============================================================================
-- basket_mat_gateway_net_outside_pagos — the complement
-- Feeds: /financiero — the "Fuera de Pagos" footnote under every net figure.
-- Same shape as the view above so the repository reads both with one query.
-- ============================================================================
CREATE MATERIALIZED VIEW basket_mat_gateway_net_outside_pagos AS
WITH outside AS (
  SELECT f.*
  FROM basket_payment_fees f
  WHERE f.platform IN (0, 4)
    AND f.captured_at IS NOT NULL
    AND NOT EXISTS (
      SELECT 1 FROM basket_v_active_payments p
      WHERE p.platform = f.platform
        AND p.platform_payment_id = f.platform_payment_id
    )
),
settlement AS (
  SELECT
    'settlement'::text          AS grain,
    captured_at::date           AS day,
    platform                    AS platform,
    settlement_currency         AS ccy,
    SUM(settlement_amount)      AS gross,
    SUM(fee_amount)             AS fees,
    SUM(COALESCE(tax_amount,0)) AS taxes,
    SUM(net_amount)             AS net,
    COUNT(*)                    AS tx_count,
    0::numeric                  AS refunded,
    0::bigint                   AS refund_count
  FROM outside
  GROUP BY captured_at::date, platform, settlement_currency
),
refunds AS (
  SELECT
    'refund'::text              AS grain,
    captured_at::date           AS day,
    platform                    AS platform,
    currency                    AS ccy,
    0::numeric                  AS gross,
    0::numeric                  AS fees,
    0::numeric                  AS taxes,
    0::numeric                  AS net,
    0::bigint                   AS tx_count,
    SUM(refunded_amount)        AS refunded,
    COUNT(*)                    AS refund_count
  FROM outside
  WHERE refunded_amount <> 0
  GROUP BY captured_at::date, platform, currency
)
SELECT * FROM settlement
UNION ALL
SELECT * FROM refunds;

CREATE UNIQUE INDEX basket_mat_gateway_net_outside_pagos_pk_idx
  ON basket_mat_gateway_net_outside_pagos(grain, day, platform, ccy);
CREATE INDEX basket_mat_gateway_net_outside_pagos_day_idx
  ON basket_mat_gateway_net_outside_pagos(day);
