-- Phase 2: Business view + materialized aggregations (BFF-optimized)
-- Each mat view feeds 1+ BFF endpoints with NO further joins/aggregations needed.
-- Idempotent: drop then recreate. Safe to re-run.

DROP MATERIALIZED VIEW IF EXISTS basket_mat_revenue_daily CASCADE;
DROP MATERIALIZED VIEW IF EXISTS basket_mat_team_monthly CASCADE;
DROP MATERIALIZED VIEW IF EXISTS basket_mat_monthly_lifecycle CASCADE;
DROP MATERIALIZED VIEW IF EXISTS basket_mat_daily_active CASCADE;
DROP VIEW IF EXISTS basket_v_active_payments CASCADE;

-- ============================================================================
-- basket_v_active_payments
-- Single source-of-truth view: enriches successful payments with derived
-- sub_type, access_type, platform_name + pre-joins users & teams.
-- All mat views read from here. status=1 filter applied once.
-- ============================================================================
CREATE VIEW basket_v_active_payments AS
SELECT
  p.id,
  p.user_id,
  p.platform,
  p.price_id,
  p.amount,
  p.currency,
  p.recurrent,
  p.expires_at,
  p.created_at,
  p.payment_country,
  u.country         AS user_country,
  u.promo_team_id   AS team_id,
  t.team_name,
  t.league,
  t.country         AS team_country,
  -- Uploaded Pagos carry no price_id (the Control Panel export omits it), so
  -- monthly rows without one fall back to the basket_price_tiers price book.
  -- See docs/adr/0003. 365 and 0 never consult price at all.
  CASE
    WHEN p.recurrent = 0                                     THEN 'Free'
    WHEN p.recurrent = 30  AND p.price_id = 100010           THEN 'Mensual_Basico'
    WHEN p.recurrent = 30  AND p.price_id IN (100030,100011) THEN 'Mensual_Total'
    WHEN p.recurrent = 30  AND p.price_id IS NULL            THEN COALESCE(tier.sub_type, 'Otros')
    WHEN p.recurrent = 365                                   THEN 'Anual_Total'
    ELSE 'Otros'
  END AS sub_type,
  CASE
    WHEN p.platform = 9 THEN 'antel'
    WHEN p.amount > 0   THEN 'real'
    ELSE                     'voucher'
  END AS access_type,
  CASE p.platform
    WHEN 0 THEN 'MercadoPago' WHEN 1 THEN 'Manual'
    WHEN 2 THEN 'Voucher'     WHEN 3 THEN 'PayPal'
    WHEN 4 THEN 'Stripe'      WHEN 9 THEN 'Antel'
    ELSE 'Unknown'
  END AS platform_name
FROM basket_payments p
JOIN basket_users u ON u.id = p.user_id
LEFT JOIN basket_teams t ON t.id = u.promo_team_id
-- Exact price-point match, not a range: ARS inflation put today's Basico price
-- above yesterday's Total price, so amount ranges misclassify across time.
-- basket_payments.currency is UPPERCASE (the mapper normalises it); the price
-- book is lowercase.
LEFT JOIN basket_price_tiers tier
  ON  tier.currency  = LOWER(p.currency)
  AND tier.recurrent = p.recurrent
  AND tier.amount    = p.amount
WHERE p.status = 1;

-- ============================================================================
-- basket_mat_daily_active
-- Grain: 1 row per calendar day.
-- Feeds: OverviewTab (KPI active today, sparkline, breakdown pies)
--        EvolutionTab (full daily series, all splits)
-- All splits computed in same scan via FILTER — single pass.
-- ============================================================================
CREATE MATERIALIZED VIEW basket_mat_daily_active AS
WITH bounds AS (
  SELECT
    GREATEST(MIN(created_at)::date, DATE '2020-01-01') AS d_min,
    LEAST(MAX((expires_at + INTERVAL '7 days'))::date, CURRENT_DATE) AS d_max
  FROM basket_v_active_payments
),
days AS (
  SELECT generate_series(b.d_min, b.d_max, INTERVAL '1 day')::date AS d
  FROM bounds b
)
SELECT
  d.d AS day,
  COUNT(DISTINCT p.user_id)                                                AS all_active,
  COUNT(DISTINCT p.user_id) FILTER (WHERE p.access_type = 'real')          AS real_active,
  COUNT(DISTINCT p.user_id) FILTER (WHERE p.access_type = 'voucher')       AS voucher_active,
  COUNT(DISTINCT p.user_id) FILTER (WHERE p.access_type = 'antel')         AS antel_active,
  COUNT(DISTINCT p.user_id) FILTER (WHERE p.sub_type = 'Free')             AS free_active,
  COUNT(DISTINCT p.user_id) FILTER (WHERE p.sub_type = 'Mensual_Basico')   AS mensual_basico_active,
  COUNT(DISTINCT p.user_id) FILTER (WHERE p.sub_type = 'Mensual_Total')    AS mensual_total_active,
  COUNT(DISTINCT p.user_id) FILTER (WHERE p.sub_type = 'Anual_Total')      AS anual_total_active,
  COUNT(DISTINCT p.user_id) FILTER (WHERE p.user_country = 'Uruguay')     AS uy_active,
  COUNT(DISTINCT p.user_id) FILTER (WHERE p.user_country = 'Argentina')   AS ar_active,
  COUNT(DISTINCT p.user_id) FILTER (WHERE p.user_country = 'Chile')       AS cl_active,
  COUNT(DISTINCT p.user_id) FILTER (WHERE p.user_country IS NULL
                                       OR p.user_country NOT IN ('Uruguay','Argentina','Chile')) AS other_active
FROM days d
LEFT JOIN basket_v_active_payments p
  ON p.created_at::date <= d.d
 AND (p.expires_at + INTERVAL '7 days')::date >= d.d
GROUP BY d.d;

CREATE UNIQUE INDEX basket_mat_daily_active_day_idx
  ON basket_mat_daily_active(day);

-- ============================================================================
-- basket_mat_monthly_lifecycle
-- Grain: 1 row per month.
-- Feeds: RetentionTab (lifecycle table, churn/retention series).
-- Pre-computes new/renewals/reactivations/expirations/churn_pct/retention_pct.
-- ============================================================================
CREATE MATERIALIZED VIEW basket_mat_monthly_lifecycle AS
WITH per_user_payment AS (
  SELECT
    user_id,
    created_at,
    expires_at,
    DATE_TRUNC('month', created_at)::date                  AS created_month,
    DATE_TRUNC('month', expires_at + INTERVAL '7 days')::date AS expire_month,
    LAG(expires_at) OVER (PARTITION BY user_id ORDER BY created_at) AS prev_expires
  FROM basket_v_active_payments
),
first_payment AS (
  SELECT user_id, MIN(created_at) AS first_at,
         DATE_TRUNC('month', MIN(created_at))::date AS first_month
  FROM basket_v_active_payments
  GROUP BY user_id
),
months AS (
  SELECT generate_series(
    (SELECT DATE_TRUNC('month', MIN(created_at))::date FROM basket_v_active_payments),
    DATE_TRUNC('month', CURRENT_DATE)::date,
    INTERVAL '1 month'
  )::date AS m
),
new_payers AS (
  SELECT first_month AS m, COUNT(*) AS c
  FROM first_payment GROUP BY first_month
),
renewals AS (
  SELECT created_month AS m, COUNT(*) AS c
  FROM per_user_payment
  WHERE prev_expires IS NOT NULL
    AND created_at <= prev_expires + INTERVAL '37 days'
  GROUP BY created_month
),
reactivations AS (
  SELECT created_month AS m, COUNT(*) AS c
  FROM per_user_payment
  WHERE prev_expires IS NOT NULL
    AND created_at > prev_expires + INTERVAL '37 days'
  GROUP BY created_month
),
expirations AS (
  SELECT expire_month AS m, COUNT(DISTINCT user_id) AS c
  FROM per_user_payment p1
  WHERE NOT EXISTS (
    SELECT 1 FROM basket_v_active_payments p2
    WHERE p2.user_id = p1.user_id
      AND p2.created_at <= (p1.expires_at + INTERVAL '7 days')
      AND p2.expires_at > p1.expires_at
  )
  GROUP BY expire_month
),
active_at_month AS (
  SELECT
    m.m,
    (SELECT COUNT(DISTINCT user_id) FROM basket_v_active_payments
       WHERE created_at::date <= m.m
         AND (expires_at + INTERVAL '7 days')::date >= m.m) AS active_start,
    (SELECT COUNT(DISTINCT user_id) FROM basket_v_active_payments
       WHERE created_at::date <= (m.m + INTERVAL '1 month' - INTERVAL '1 day')::date
         AND (expires_at + INTERVAL '7 days')::date
              >= (m.m + INTERVAL '1 month' - INTERVAL '1 day')::date) AS active_end
  FROM months m
)
SELECT
  a.m AS month,
  a.active_start,
  a.active_end,
  COALESCE(n.c, 0)  AS new_payers,
  COALESCE(r.c, 0)  AS renewals,
  COALESCE(x.c, 0)  AS reactivations,
  COALESCE(e.c, 0)  AS expirations,
  CASE WHEN a.active_start > 0
       THEN ROUND(100.0 * COALESCE(e.c, 0) / a.active_start, 2)
       ELSE 0 END AS churn_rate_pct,
  CASE WHEN a.active_start > 0
       THEN ROUND(100.0 * (a.active_start - COALESCE(e.c, 0)) / a.active_start, 2)
       ELSE 0 END AS retention_rate_pct
FROM active_at_month a
LEFT JOIN new_payers    n ON n.m = a.m
LEFT JOIN renewals      r ON r.m = a.m
LEFT JOIN reactivations x ON x.m = a.m
LEFT JOIN expirations   e ON e.m = a.m;

CREATE UNIQUE INDEX basket_mat_monthly_lifecycle_month_idx
  ON basket_mat_monthly_lifecycle(month);

-- ============================================================================
-- basket_mat_team_monthly
-- Grain: team × month. Team metadata pre-joined.
-- Feeds: TeamsTab (ranking, drill-down trend).
-- ============================================================================
CREATE MATERIALIZED VIEW basket_mat_team_monthly AS
SELECT
  COALESCE(p.team_id, 0)                              AS team_id,
  COALESCE(p.team_name, 'Sin equipo')                 AS team_name,
  COALESCE(p.league, 'N/A')                           AS league,
  COALESCE(p.team_country, 'N/A')                     AS team_country,
  DATE_TRUNC('month', p.created_at)::date             AS month,
  COUNT(DISTINCT p.user_id)                           AS unique_payers,
  COUNT(*)                                            AS total_payments,
  COALESCE(SUM(p.amount), 0)                          AS total_amount,
  COUNT(DISTINCT p.user_id) FILTER (WHERE p.access_type = 'real')    AS real_payers,
  COUNT(DISTINCT p.user_id) FILTER (WHERE p.access_type = 'voucher') AS voucher_payers
FROM basket_v_active_payments p
GROUP BY p.team_id, p.team_name, p.league, p.team_country,
         DATE_TRUNC('month', p.created_at);

CREATE UNIQUE INDEX basket_mat_team_monthly_pk_idx
  ON basket_mat_team_monthly(team_id, month);
CREATE INDEX basket_mat_team_monthly_league_idx
  ON basket_mat_team_monthly(league);
CREATE INDEX basket_mat_team_monthly_country_idx
  ON basket_mat_team_monthly(team_country);

-- ============================================================================
-- basket_mat_revenue_daily
-- Grain: day × currency × user_country × platform.
-- Feeds: FinanceTab (revenue series, platform breakdown, currency split).
-- Filter: amount > 0 OR platform = 9 (Antel = real even if amount = 0).
-- ============================================================================
CREATE MATERIALIZED VIEW basket_mat_revenue_daily AS
SELECT
  p.created_at::date                              AS day,
  COALESCE(p.currency, 'NONE')                    AS currency,
  COALESCE(p.user_country, 'N/A')                 AS user_country,
  p.platform                                      AS platform,
  p.platform_name                                 AS platform_name,
  COUNT(*)                                        AS payment_count,
  COALESCE(SUM(p.amount), 0)                      AS total_amount,
  COUNT(*) FILTER (WHERE p.access_type = 'real')  AS real_count,
  COALESCE(SUM(p.amount) FILTER (WHERE p.access_type = 'real'), 0) AS real_amount
FROM basket_v_active_payments p
WHERE p.amount > 0 OR p.platform = 9
GROUP BY p.created_at::date, p.currency, p.user_country, p.platform, p.platform_name;

CREATE UNIQUE INDEX basket_mat_revenue_daily_pk_idx
  ON basket_mat_revenue_daily(day, currency, user_country, platform);
CREATE INDEX basket_mat_revenue_daily_day_idx
  ON basket_mat_revenue_daily(day);
CREATE INDEX basket_mat_revenue_daily_platform_idx
  ON basket_mat_revenue_daily(platform);
