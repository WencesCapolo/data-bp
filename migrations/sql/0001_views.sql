-- Phase 2: Business view + materialized aggregations (BFF-optimized)
-- Each mat view feeds 1+ BFF endpoints with NO further joins/aggregations needed.
-- Idempotent: drop then recreate. Safe to re-run.

DROP MATERIALIZED VIEW IF EXISTS basket_mat_gateway_net_daily CASCADE;
DROP MATERIALIZED VIEW IF EXISTS basket_mat_revenue_daily CASCADE;
DROP MATERIALIZED VIEW IF EXISTS basket_mat_team_daily CASCADE;
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
  -- The gateway id, carried so the fee mirror can be joined to *filtered*
  -- payments: basket_payment_fees is keyed (platform, platform_payment_id) and
  -- has no user dimension of its own. NULL for Manual, Voucher and Antel.
  p.platform_payment_id,
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
-- Stops at the last COMPLETE month. The in-progress month would count every
-- subscription expiring later this month as already churned while none of them
-- has had its chance to renew yet — a full month of expirations against a few
-- days of renewals, which reads as a collapse that never happened. The previous
-- month is fully settled: its last expire event is expires_at + 7d < month end.
months AS (
  SELECT generate_series(
    (SELECT DATE_TRUNC('month', MIN(created_at))::date FROM basket_v_active_payments),
    (DATE_TRUNC('month', CURRENT_DATE) - INTERVAL '1 month')::date,
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
-- basket_mat_team_daily
-- Grain: team × day, SPARSE — one row only where there was movement or a pago.
-- Feeds: TeamsTab / Equipos (daily altas/bajas, active-subs series, money).
-- Consumers cumulative-sum `delta` over their window to rebuild active subs,
-- so every event day must be present even when there is no pago that day.
-- Altas/bajas come from merging each Subscriber's payment spans into islands of
-- uninterrupted access (7-day grace, same as every other basket query): an
-- island start is an alta, the day after an island end is a baja. Islands are
-- built over full history, so an alta is a genuinely new or reactivated
-- Subscriber, never a window-edge artefact.
-- ============================================================================
CREATE MATERIALIZED VIEW basket_mat_team_daily AS
WITH spans AS (
  SELECT v.user_id, COALESCE(v.team_id, 0) AS team_id,
         v.created_at::date AS s,
         (v.expires_at + INTERVAL '7 days')::date AS e
  FROM basket_v_active_payments v
  -- 977 Pagos carry an expires_at before their own created_at (some at epoch).
  -- They are active on no day at all under the condition every other query
  -- uses, so they must produce neither an alta nor a baja — without this guard
  -- their baja lands decades before their alta and drags the level negative.
  WHERE (v.expires_at + INTERVAL '7 days')::date >= v.created_at::date
),
ord AS (
  SELECT user_id, team_id, s, e,
         MAX(e) OVER (PARTITION BY user_id ORDER BY s
                      ROWS BETWEEN UNBOUNDED PRECEDING AND 1 PRECEDING) AS prev_max
  FROM spans
),
grp AS (
  SELECT user_id, team_id, s, e,
         SUM(CASE WHEN prev_max IS NULL OR s > prev_max + 1 THEN 1 ELSE 0 END)
           OVER (PARTITION BY user_id ORDER BY s) AS island
  FROM ord
),
islands AS (
  SELECT user_id, team_id, MIN(s) AS s, MAX(e) AS e
  FROM grp GROUP BY user_id, team_id, island
),
ev AS (
  SELECT team_id, s     AS d, 1 AS alta, 0 AS baja FROM islands
  UNION ALL
  SELECT team_id, e + 1 AS d, 0 AS alta, 1 AS baja FROM islands
),
mov AS (
  SELECT team_id, d AS day, SUM(alta)::int AS altas, SUM(baja)::int AS bajas
  FROM ev GROUP BY 1, 2
),
money AS (
  SELECT COALESCE(team_id, 0) AS team_id, created_at::date AS day,
         COUNT(*)::int AS payments, COALESCE(SUM(amount), 0) AS amount,
         COUNT(DISTINCT user_id)::int AS unique_payers
  FROM basket_v_active_payments GROUP BY 1, 2
),
joined AS (
  SELECT
    COALESCE(mov.team_id, money.team_id)     AS team_id,
    COALESCE(mov.day, money.day)             AS day,
    COALESCE(mov.altas, 0)                   AS altas,
    COALESCE(mov.bajas, 0)                   AS bajas,
    COALESCE(money.payments, 0)              AS payments,
    COALESCE(money.amount, 0)                AS amount,
    COALESCE(money.unique_payers, 0)         AS unique_payers
  FROM mov
  FULL OUTER JOIN money ON money.team_id = mov.team_id AND money.day = mov.day
)
SELECT
  j.team_id                              AS team_id,
  COALESCE(t.team_name, 'Sin equipo')    AS team_name,
  COALESCE(t.league, 'N/A')              AS league,
  COALESCE(t.country, 'N/A')             AS team_country,
  j.day                                  AS day,
  j.altas                                AS altas,
  j.bajas                                AS bajas,
  (j.altas - j.bajas)                    AS delta,
  j.payments                             AS payments,
  j.amount                               AS amount,
  j.unique_payers                        AS unique_payers
FROM joined j
LEFT JOIN basket_teams t ON t.id = j.team_id;

CREATE UNIQUE INDEX basket_mat_team_daily_pk_idx
  ON basket_mat_team_daily(team_id, day);
CREATE INDEX basket_mat_team_daily_day_idx
  ON basket_mat_team_daily(day);

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

-- ============================================================================
-- basket_mat_gateway_net_daily
-- Grain: grain × day × platform × ccy, where `grain` names which currency plane
--        the row belongs to. Two planes cannot share a row: a settlement fee
--        and a presentment refund are denominated in different currencies.
--          'settlement' -> ccy = settlement_currency; gross/fees/net/tx_count
--          'refund'     -> ccy = currency (presentment); refunded/refund_count
--        The columns of the other plane are zero, never NULL, so a SUM over a
--        filtered subset needs no COALESCE.
-- Feeds: FinanceTab (net revenue, fee ratio, refunds).
--
-- CLOCK: captured_at, true UTC. basket_payments.created_at is Argentina local
-- time stored as UTC — a 3-hour skew. Nothing in this view reads created_at, so
-- every bucket here is on the one clock. Do not add a column bucketed on the
-- other one; put it in its own view instead.
--
-- SEAM: `WHERE platform IN (0, 4)` — MercadoPago and Stripe, the two Providers
-- whose fee mirror has rows. It was Stripe alone until MercadoPago's Cobros
-- Export was ingested; widening it was the one-line change the original shape
-- was built for, and grouping by settlement_currency from the start is what
-- made it additive: MP settles ARS into ARS, so its rows land in their own ccy
-- bucket rather than polluting a USD total.
--
-- The predicate stays a whitelist rather than becoming `platform IS NOT NULL`.
-- PayPal takes real money and has no fee feed at all (90 Subscriptions, no
-- source), so an un-gated view would render every PayPal transaction as zero
-- revenue — which reads as "cost us nothing" instead of "we do not know".
--
-- TAX: `taxes` exists because MercadoPago withholds tax at source and reports
-- no column for it — see migrations/sql/0015. It is NOT part of `fees`: a
-- commission is spent, a withholding is a tax credit. Stripe's rows carry 0.
-- The invariant every consumer may rely on is gross - fees - taxes = net.
--
-- No FX IN THIS VIEW, by choice rather than for want of a table. basket_fx_rates
-- exists (migration 0017) and the USD conversion happens one layer up, in
-- core/services/usdConversion.ts, off this view's DAY grain: a rate is a day's
-- rate, and pre-aggregating a converted total here would freeze it at whatever
-- rates were loaded the last time the view was refreshed. So there is still no
-- all-currency total anywhere in this view, and every row stays in the currency
-- the Provider settled.
-- ============================================================================
CREATE MATERIALIZED VIEW basket_mat_gateway_net_daily AS
WITH settlement AS (
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
  FROM basket_payment_fees
  WHERE platform IN (0, 4) AND captured_at IS NOT NULL
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
  FROM basket_payment_fees
  WHERE platform IN (0, 4) AND captured_at IS NOT NULL AND refunded_amount <> 0
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
