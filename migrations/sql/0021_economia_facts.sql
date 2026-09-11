-- The Pagos fact table and the two Sync-invariant figures of /financiero ·
-- Economía, precomputed. Apply with:
--
--   pnpm sql:apply migrations/sql/0021_economia_facts.sql
--
-- Three materialized views, refreshed with the rest at the end of every Sync
-- (GitHub issue #6). Idempotent: drop, then recreate.
--
-- WHY. One Economía request ran 20 queries and 1.7 s on the default range,
-- 6 s on "todo": every live query rebuilt basket_v_active_payments' join
-- (Pagos ⨝ Subscribers ⨝ Tier lookup, 500k rows, a seq scan of 262k
-- Subscribers each time), and 2.3 s of each request went to figures that
-- depend on neither the range nor the filter and only move at Sync — the fee
-- coverage buckets and the rolling-window pair anchored at the last Pago day.
--
--   basket_mat_payment_facts   the Pagos view, materialized and widened with
--                              the columns Economía derives on every read
--                              (month, plan family, Period, season, the
--                              coalesced country and currency labels). Every
--                              Economía query — filtered or not — reads it
--                              instead of the view.
--   basket_mat_fee_coverage    successful Pagos vs fee rows per Provider,
--                              currency and id shape, all-time. Was the single
--                              most expensive query of the request (≈1 s), and
--                              a filter never applied to it.
--   basket_mat_period_windows  the two rolling windows (últimos 30 días and
--                              the 30 before) cut at the anchor: Pagos by what
--                              they meant for the Subscriber, and the pool at
--                              each window's close. One row per window. Only
--                              the unfiltered path reads it; a filter still
--                              runs these live, off the fact table.
--
-- The labels here must stay identical to what the live (filtered) path
-- computes, or the byCountry table grows a second unknown bucket: 'N/A' for a
-- Pago whose Subscriber has no country, 'NONE' for a voucher's missing
-- currency — the same two coalesces basket_mat_revenue_daily makes.

DROP MATERIALIZED VIEW IF EXISTS basket_mat_period_windows CASCADE;
DROP MATERIALIZED VIEW IF EXISTS basket_mat_fee_coverage CASCADE;
DROP MATERIALIZED VIEW IF EXISTS basket_mat_payment_facts CASCADE;

-- ============================================================================
-- basket_mat_payment_facts
-- Grain: 1 row per successful Pago (basket_v_active_payments, unchanged
-- population). sub_type, access_type and platform_name come from the view so
-- ADR 0002 and ADR 0003 keep a single home.
--
-- Season is the sporting one, Sep→Aug, labelled by both halves ("2025/26"): a
-- Pago in Jan 2026 belongs to 2025/26.
-- ============================================================================
CREATE MATERIALIZED VIEW basket_mat_payment_facts AS
SELECT
  v.id,
  v.user_id,
  v.platform,
  v.platform_payment_id,
  v.amount,
  v.currency,
  v.recurrent,
  v.expires_at,
  v.created_at,
  v.user_country,
  v.sub_type,
  v.access_type,
  v.platform_name,
  DATE_TRUNC('month', v.created_at)::date          AS month,
  COALESCE(v.user_country, 'N/A')                  AS country,
  COALESCE(v.currency, 'NONE')                     AS ccy,
  CASE
    WHEN v.sub_type = 'Mensual_Basico' THEN 'Básico'
    WHEN v.sub_type IN ('Mensual_Total', 'Anual_Total') THEN 'Total'
    ELSE v.sub_type
  END                                              AS plan_family,
  CASE
    WHEN v.sub_type LIKE 'Mensual%' THEN 'Mensual'
    WHEN v.sub_type LIKE 'Anual%'   THEN 'Anual'
    WHEN v.recurrent = 0            THEN 'Free'
    ELSE 'Otros'
  END                                              AS plan_frequency,
  CASE WHEN EXTRACT(MONTH FROM v.created_at) >= 9
    THEN EXTRACT(YEAR FROM v.created_at)::int || '/' || RIGHT((EXTRACT(YEAR FROM v.created_at)::int + 1)::text, 2)
    ELSE (EXTRACT(YEAR FROM v.created_at)::int - 1) || '/' || RIGHT(EXTRACT(YEAR FROM v.created_at)::text, 2)
  END                                              AS season,
  (v.recurrent = 0 AND v.amount > 0)               AS one_off
FROM basket_v_active_payments v;

CREATE UNIQUE INDEX basket_mat_payment_facts_pk_idx
  ON basket_mat_payment_facts (id);
CREATE INDEX basket_mat_payment_facts_created_idx
  ON basket_mat_payment_facts (created_at);
CREATE INDEX basket_mat_payment_facts_expires_idx
  ON basket_mat_payment_facts (expires_at);
CREATE INDEX basket_mat_payment_facts_user_created_idx
  ON basket_mat_payment_facts (user_id, created_at) INCLUDE (expires_at);
CREATE INDEX basket_mat_payment_facts_gateway_id_idx
  ON basket_mat_payment_facts (platform, platform_payment_id)
  WHERE platform_payment_id IS NOT NULL;
-- Three covering indexes in the order of Economía's three GROUP BYs, so a
-- distinct-payer count or the catálogo streams off an index-only scan already
-- sorted, instead of sorting 500k rows on disk (7–10× on range=all). The range
-- predicate is a filter on the INCLUDEd created_at; no heap fetch.
CREATE INDEX basket_mat_payment_facts_country_grain_idx
  ON basket_mat_payment_facts (country, ccy, user_id) INCLUDE (created_at, amount);
CREATE INDEX basket_mat_payment_facts_month_grain_idx
  ON basket_mat_payment_facts (month, ccy, user_id) INCLUDE (created_at, amount);
CREATE INDEX basket_mat_payment_facts_catalog_idx
  ON basket_mat_payment_facts (plan_family, plan_frequency, country, ccy, season, amount) INCLUDE (created_at);

-- ============================================================================
-- basket_mat_fee_coverage
-- Grain: 1 row per Provider × currency × id shape, all-time on purpose:
-- coverage moves when Pagos are ingested, not only when fees are, so a
-- range-windowed figure reads as a regression when it is really new Pagos.
--
-- Off basket_payments, not the Pagos view: a Pago whose Subscriber row is
-- missing still took money through the Provider and still may hold a fee row.
-- Bucketed by id SHAPE as well as currency because MercadoPago has two: numeric
-- ids are payments and can carry a fee, hex32 ids are preapprovals —
-- subscription objects that never had a fee to report.
-- ============================================================================
CREATE MATERIALIZED VIEW basket_mat_fee_coverage AS
SELECT p.platform                        AS platform,
       p.currency                        AS currency,
       CASE WHEN p.platform_payment_id ~ '^[0-9a-f]{32}$'
            THEN 'preapproval' ELSE 'payment' END AS id_shape,
       COUNT(*)::int                     AS successful,
       COUNT(f.platform_payment_id)::int AS with_fee
FROM basket_payments p
LEFT JOIN basket_payment_fees f
  ON f.platform = p.platform AND f.platform_payment_id = p.platform_payment_id
WHERE p.platform IN (0, 4)
  AND p.status = 1
  AND p.platform_payment_id IS NOT NULL
GROUP BY p.platform, p.currency, id_shape;

CREATE UNIQUE INDEX basket_mat_fee_coverage_pk_idx
  ON basket_mat_fee_coverage (platform, currency, id_shape);

-- ============================================================================
-- basket_mat_period_windows
-- Grain: 1 row per rolling window, 'current' and 'previous', 30 days each,
-- ending at the anchor — the last day with a Pago, capped at yesterday, the
-- same anchor every lifecycle figure hangs from.
--
-- tx: the window's Pagos by what they meant for the Subscriber. A paid Pago
-- with no recurring right is a single match (one_off). Otherwise the first Pago
-- of the Subscriber's life is an alta, a later one within 37 days of the
-- previous expiry is a renewal, past that a reactivation. The LAG needs the
-- Subscriber's whole history, restricted to the Subscribers who paid in the
-- 60 days.
--
-- active: the pool at the window's last day — every Subscriber some Pago
-- covers, with the 7-day grace — split by Period and by family. Per-Tier
-- splits count a Subscriber once per Tier held that day.
-- ============================================================================
CREATE MATERIALIZED VIEW basket_mat_period_windows AS
WITH anchor AS (
  SELECT LEAST(MAX(created_at)::date, CURRENT_DATE - 1) AS as_of
  FROM basket_mat_payment_facts
),
w AS (
  SELECT 'current'::text AS w, as_of - 29 AS s, as_of AS e, as_of FROM anchor
  UNION ALL
  SELECT 'previous', as_of - 59, as_of - 30, as_of FROM anchor
),
p AS (
  SELECT f.user_id, f.created_at, f.sub_type, f.one_off,
         LAG(f.expires_at) OVER (PARTITION BY f.user_id ORDER BY f.created_at, f.id) AS prev_e,
         MIN(f.created_at) OVER (PARTITION BY f.user_id) AS first_at
  FROM basket_mat_payment_facts f
  WHERE f.user_id IN (
    SELECT user_id FROM basket_mat_payment_facts, anchor
    WHERE created_at >= as_of - 59 AND created_at < as_of + 1
  )
),
tx AS (
  SELECT w.w,
    COUNT(*) FILTER (WHERE one_off)::int AS one_off,
    COUNT(*) FILTER (WHERE NOT one_off AND created_at = first_at)::int AS new_subscribers,
    COUNT(*) FILTER (WHERE NOT one_off AND created_at <> first_at
                       AND created_at <= prev_e + INTERVAL '37 days')::int AS recurring,
    COUNT(*) FILTER (WHERE NOT one_off AND created_at <> first_at
                       AND created_at > prev_e + INTERVAL '37 days')::int AS reactivated,
    COUNT(*) FILTER (WHERE NOT one_off AND sub_type LIKE 'Mensual%')::int AS mensual,
    COUNT(*) FILTER (WHERE NOT one_off AND sub_type = 'Anual_Total')::int  AS anual
  FROM w JOIN p ON p.created_at >= w.s AND p.created_at < w.e + 1
  GROUP BY w.w
),
active AS (
  SELECT w.w,
    COUNT(DISTINCT f.user_id)::int AS total,
    COUNT(DISTINCT f.user_id) FILTER (WHERE f.sub_type LIKE 'Mensual%')::int AS mensual,
    COUNT(DISTINCT f.user_id) FILTER (WHERE f.sub_type = 'Anual_Total')::int  AS anual,
    COUNT(DISTINCT f.user_id) FILTER (WHERE f.sub_type IN ('Mensual_Total', 'Anual_Total'))::int AS fam_total,
    COUNT(DISTINCT f.user_id) FILTER (WHERE f.sub_type = 'Mensual_Basico')::int AS fam_basico
  FROM w
  JOIN basket_mat_payment_facts f
    ON f.created_at < w.e + 1 AND f.expires_at >= w.e - INTERVAL '7 days'
  GROUP BY w.w
)
SELECT w.w, w.s AS start_day, w.e AS end_day, w.as_of,
       COALESCE(tx.one_off, 0)         AS one_off,
       COALESCE(tx.new_subscribers, 0) AS new_subscribers,
       COALESCE(tx.recurring, 0)       AS recurring,
       COALESCE(tx.reactivated, 0)     AS reactivated,
       COALESCE(tx.mensual, 0)         AS mensual,
       COALESCE(tx.anual, 0)           AS anual,
       COALESCE(active.total, 0)       AS active_total,
       COALESCE(active.mensual, 0)     AS active_mensual,
       COALESCE(active.anual, 0)       AS active_anual,
       COALESCE(active.fam_total, 0)   AS active_fam_total,
       COALESCE(active.fam_basico, 0)  AS active_fam_basico
FROM w
LEFT JOIN tx ON tx.w = w.w
LEFT JOIN active ON active.w = w.w;

CREATE UNIQUE INDEX basket_mat_period_windows_pk_idx
  ON basket_mat_period_windows (w);

ANALYZE basket_mat_payment_facts;
ANALYZE basket_mat_fee_coverage;
ANALYZE basket_mat_period_windows;
