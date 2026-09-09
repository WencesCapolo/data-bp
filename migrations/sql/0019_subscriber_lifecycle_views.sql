-- Subscriber lifecycle at day grain, precomputed for the unfiltered path of
-- /financiero. Apply with:
--
--   pnpm sql:apply migrations/sql/0019_subscriber_lifecycle_views.sql
--
-- Four materialized views, all derived from Pagos (basket_v_active_payments)
-- and refreshed with the rest at the end of every Sync. Idempotent: drop, then
-- recreate. They exist because the live version of these queries costs 4–8 s
-- per request against a 500 ms budget: the daily view alone merges every
-- Subscriber's Pagos into stretches of coverage before it can count who came
-- and went, and nothing about that changes between two Syncs. Filtered requests
-- (country, access type, Tier) still run live — the same split every other tab
-- makes.
--
-- The one rule, used everywhere here as it is everywhere else in the app: a
-- Subscriber is in the pool on a day when some successful Pago has
-- created_at ≤ day ≤ expires_at + 7 days.

DROP MATERIALIZED VIEW IF EXISTS basket_mat_subscriber_days CASCADE;
DROP MATERIALIZED VIEW IF EXISTS basket_mat_subscriber_months CASCADE;
DROP MATERIALIZED VIEW IF EXISTS basket_mat_subscription_last_charge CASCADE;
DROP MATERIALIZED VIEW IF EXISTS basket_mat_subscriber_lifetime CASCADE;

-- ============================================================================
-- basket_mat_subscriber_days
-- Grain: 1 row per calendar day, from the first Pago to the last day any Pago
-- covers (capped at today).
-- Feeds: /financiero — the last-15-days pair, the consolidated chart's actives
--        line, and actives at month close (the month-end rows).
--
-- Gaps and islands: a Subscriber's overlapping or abutting Pagos merge into one
-- stretch of coverage. Entering the pool is the first day of a stretch, leaving
-- it is the day after the last, and the day-to-day change of `active` is
-- exactly new + reactivated − churned. A stretch that begins on the day of the
-- Subscriber's first Pago ever is an alta nueva; any later one is a
-- reactivation. The per-Tier splits count a Subscriber once per Tier they hold
-- that day, so mensual + anual + otros ≥ active.
-- ============================================================================
CREATE MATERIALIZED VIEW basket_mat_subscriber_days AS
WITH cov AS (
  SELECT user_id, sub_type,
         created_at::date                        AS s,
         (expires_at + INTERVAL '7 days')::date  AS e
  FROM basket_v_active_payments
),
marked AS (
  SELECT user_id, s, e,
         MAX(e) OVER (PARTITION BY user_id ORDER BY s, e
                      ROWS BETWEEN UNBOUNDED PRECEDING AND 1 PRECEDING) AS prev_e
  FROM cov
),
grouped AS (
  SELECT user_id, s, e,
         SUM(CASE WHEN prev_e IS NULL OR s > prev_e + 1 THEN 1 ELSE 0 END)
           OVER (PARTITION BY user_id ORDER BY s, e) AS island
  FROM marked
),
islands AS (
  SELECT user_id, MIN(s) AS s, MAX(e) AS e FROM grouped GROUP BY user_id, island
),
first_pago AS (
  SELECT user_id, MIN(created_at)::date AS f FROM basket_payments WHERE status = 1 GROUP BY user_id
),
bounds AS (
  SELECT MIN(s) AS d_min, LEAST(MAX(e), CURRENT_DATE) AS d_max FROM cov
),
days AS (
  SELECT generate_series(b.d_min, b.d_max, INTERVAL '1 day')::date AS d FROM bounds b
),
moves AS (
  SELECT d.d,
         COUNT(*) FILTER (WHERE i.s = d.d AND f.f = d.d)::int   AS new_subscribers,
         COUNT(*) FILTER (WHERE i.s = d.d AND f.f < d.d)::int   AS reactivated,
         COUNT(*) FILTER (WHERE i.e = d.d - 1)::int             AS churned,
         COUNT(*) FILTER (WHERE i.s <= d.d AND i.e >= d.d)::int AS active
  FROM days d
  LEFT JOIN islands i ON i.s <= d.d AND i.e >= d.d - 1
  LEFT JOIN first_pago f ON f.user_id = i.user_id
  GROUP BY d.d
),
tiers AS (
  SELECT d.d,
         COUNT(DISTINCT c.user_id) FILTER (WHERE c.sub_type LIKE 'Mensual%')::int AS active_mensual,
         COUNT(DISTINCT c.user_id) FILTER (WHERE c.sub_type = 'Anual_Total')::int AS active_anual,
         COUNT(DISTINCT c.user_id) FILTER (WHERE c.sub_type NOT LIKE 'Mensual%'
                                             AND c.sub_type <> 'Anual_Total')::int AS active_otros
  FROM days d
  LEFT JOIN cov c ON c.s <= d.d AND c.e >= d.d
  GROUP BY d.d
)
SELECT m.d AS day,
       m.new_subscribers, m.reactivated, m.churned, m.active,
       t.active_mensual, t.active_anual, t.active_otros
FROM moves m JOIN tiers t ON t.d = m.d;

CREATE UNIQUE INDEX basket_mat_subscriber_days_day_idx
  ON basket_mat_subscriber_days(day);

-- ============================================================================
-- basket_mat_subscriber_months
-- Grain: 1 row per month with a Pago or a lapse, including the month in
-- progress (the query clamps to the last Pago day).
-- Feeds: /financiero — "Transacciones mensuales".
--
-- Each Pago classified by what it meant for its Subscriber: the first of their
-- life, a renewal (within 37 days of the previous Pago's expiry — the threshold
-- basket_mat_monthly_lifecycle uses), a reactivation (later than that), or a
-- single match (paid, no recurring right). `churned` is Subscribers whose
-- coverage ran out in the month with no later Pago overlapping it — the mat
-- lifecycle's `expirations`, kept at the month it happened rather than stopped
-- at the last complete month, because the chart draws the month in progress
-- and says so.
--
-- Lapses stop at the last Pago day, not today. Pagos arrive by Upload, so the
-- days after the last one hold every scheduled expiry and no renewal: counted
-- to today, the month in progress would report the whole pool as churned at
-- exactly the rate people were due to renew. The same anchor rules every
-- figure on the tab, and the live (filtered) query uses it too.
-- ============================================================================
CREATE MATERIALIZED VIEW basket_mat_subscriber_months AS
WITH p AS (
  SELECT user_id, created_at, expires_at,
         (recurrent = 0 AND amount > 0) AS one_off,
         LAG(expires_at) OVER (PARTITION BY user_id ORDER BY created_at, id) AS prev_e,
         MIN(created_at) OVER (PARTITION BY user_id)                          AS first_at
  FROM basket_v_active_payments
),
buckets AS (
  SELECT DATE_TRUNC('month', created_at)::date AS m,
         COUNT(*) FILTER (WHERE one_off)::int AS one_off,
         COUNT(*) FILTER (WHERE NOT one_off AND created_at = first_at)::int AS new_subscribers,
         COUNT(*) FILTER (WHERE NOT one_off AND created_at <> first_at
                            AND created_at <= prev_e + INTERVAL '37 days')::int AS recurring,
         COUNT(*) FILTER (WHERE NOT one_off AND created_at <> first_at
                            AND created_at > prev_e + INTERVAL '37 days')::int AS reactivated
  FROM p GROUP BY 1
),
lapsed AS (
  SELECT DATE_TRUNC('month', p1.expires_at + INTERVAL '7 days')::date AS m,
         COUNT(DISTINCT p1.user_id)::int AS churned
  FROM basket_v_active_payments p1
  WHERE (p1.expires_at + INTERVAL '7 days')::date
        <= (SELECT LEAST(MAX(created_at)::date, CURRENT_DATE - 1) FROM basket_v_active_payments)
    AND NOT EXISTS (
      SELECT 1 FROM basket_v_active_payments p2
      WHERE p2.user_id = p1.user_id
        AND p2.created_at <= p1.expires_at + INTERVAL '7 days'
        AND p2.expires_at > p1.expires_at
    )
  GROUP BY 1
)
SELECT COALESCE(b.m, l.m)          AS month,
       COALESCE(b.one_off, 0)         AS one_off,
       COALESCE(b.new_subscribers, 0) AS new_subscribers,
       COALESCE(b.recurring, 0)       AS recurring,
       COALESCE(b.reactivated, 0)     AS reactivated,
       COALESCE(l.churned, 0)         AS churned
FROM buckets b FULL OUTER JOIN lapsed l ON l.m = b.m;

CREATE UNIQUE INDEX basket_mat_subscriber_months_month_idx
  ON basket_mat_subscriber_months(month);

-- ============================================================================
-- basket_mat_subscription_last_charge
-- Grain: 1 row per Provider subscription in the mirror, live or not, with the
-- date of the last successful Pago that could be tied to it (NULL when none).
-- Feeds: /financiero — "activos por antigüedad del último cargo". The query
--        picks the live statuses and buckets the age at the last Pago day; the
--        status list lives in code (LIVE_STATUSES) and is not repeated here.
--
-- Three bridges, because the Providers left different breadcrumbs: a
-- MercadoPago Pago names its preapproval either as its own platform_payment_id
-- (the hex32 ids) or through the fee mirror's subscription_id — the fee row's
-- captured_at is the charge's own date, so the Pago need not be joined; a
-- Stripe Pago reaches its subscription only through the customer's email.
-- ============================================================================
CREATE MATERIALIZED VIEW basket_mat_subscription_last_charge AS
WITH subs AS (
  SELECT platform, subscription_id, customer_id FROM basket_gateway_subscriptions
),
lc AS (
  SELECT platform, subscription_id, MAX(lc) AS lc FROM (
    SELECT s.platform, s.subscription_id, MAX(p.created_at) AS lc
    FROM subs s
    JOIN basket_payments p
      ON p.platform = 0 AND p.status = 1 AND p.platform_payment_id = s.subscription_id
    WHERE s.platform = 0 GROUP BY 1, 2
    UNION ALL
    SELECT s.platform, s.subscription_id, MAX(f.captured_at)
    FROM subs s
    JOIN basket_payment_fees f ON f.platform = 0 AND f.subscription_id = s.subscription_id
    WHERE s.platform = 0 AND f.gross_amount > 0 GROUP BY 1, 2
    UNION ALL
    SELECT s.platform, s.subscription_id, MAX(p.created_at)
    FROM subs s
    JOIN basket_gateway_customers c ON c.platform = 4 AND c.customer_id = s.customer_id
    JOIN basket_users u ON LOWER(u.email) = LOWER(c.email)
    JOIN basket_payments p ON p.user_id = u.id AND p.platform = 4 AND p.status = 1
    WHERE s.platform = 4 GROUP BY 1, 2
  ) x GROUP BY 1, 2
)
SELECT s.platform, s.subscription_id, lc.lc AS last_charge_at
FROM subs s LEFT JOIN lc ON lc.platform = s.platform AND lc.subscription_id = s.subscription_id;

CREATE UNIQUE INDEX basket_mat_subscription_last_charge_pk_idx
  ON basket_mat_subscription_last_charge(platform, subscription_id);

-- ============================================================================
-- basket_mat_subscriber_lifetime
-- Grain: 1 row per Subscriber with a successful Pago.
-- Feeds: /financiero — "promedio de vida de un suscriptor". The query decides
--        which lifetimes are closed (last_covered < the last Pago day) and
--        takes the percentiles; it carries the Subscriber's country so a
--        country filter can still be served from here.
--
-- `months` is paid coverage summed across the Subscriber's Pagos — a month per
-- monthly Pago, twelve per annual — not the span between first and last. A
-- renewal five days early is a month bought, and "how many months did they pay
-- for" is the question being answered.
-- ============================================================================
CREATE MATERIALIZED VIEW basket_mat_subscriber_lifetime AS
SELECT user_id,
       MAX(user_country)                                                          AS user_country,
       SUM(GREATEST(EXTRACT(EPOCH FROM (expires_at - created_at)), 0)) / 86400.0 / 30.0 AS months,
       MAX((expires_at + INTERVAL '7 days')::date)                               AS last_covered
FROM basket_v_active_payments
GROUP BY user_id;

CREATE UNIQUE INDEX basket_mat_subscriber_lifetime_user_idx
  ON basket_mat_subscriber_lifetime(user_id);
