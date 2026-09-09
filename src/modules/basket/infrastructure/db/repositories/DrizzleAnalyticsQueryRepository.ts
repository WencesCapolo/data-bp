import { sql } from 'drizzle-orm';
import { db, type Db } from '@shared/db/client';
import type { IAnalyticsQueryRepository } from '@basket/core/ports/IAnalyticsQueryRepository';
import {
  hasFilters,
  type CommonFilters,
  type DateRange,
  type Granularity,
} from '@basket/core/dtos/shared';
import type {
  OverviewDTO,
  OverviewBreakdown,
  OverviewTrendPoint,
} from '@basket/core/dtos/OverviewDTO';
import type { EvolutionDTO } from '@basket/core/dtos/EvolutionDTO';
import type { TeamsDTO, TeamRankRow, TeamDailyDTO } from '@basket/core/dtos/TeamsDTO';
import type { FinanceDTO } from '@basket/core/dtos/FinanceDTO';
import type { GatewayNetDTO, NetDailyPoint } from '@basket/core/dtos/GatewayNetDTO';
import { LIVE_STATUSES, subscriptionLifecycle } from '@basket/core/entities/GatewaySubscription';
import {
  indexRates,
  usdByMonth,
  usdTotals,
  type DailyRate,
} from '@basket/core/services/usdConversion';
import type { EconomiaDTO } from '@basket/core/dtos/EconomiaDTO';
import type {
  LastChargeBucket,
  PeriodWindow,
  SubscriberLifecycleDTO,
} from '@basket/core/dtos/SubscriberLifecycleDTO';
import type {
  ContenidoDTO,
  ContenidoEventDayRow,
  ContenidoTopRow,
} from '@basket/core/dtos/ContenidoDTO';
import type { RetentionDTO } from '@basket/core/dtos/RetentionDTO';
import type { LifecycleDTO } from '@basket/core/dtos/LifecycleDTO';
import type { DataQualityDTO, SyncLogEntry } from '@basket/core/dtos/DataQualityDTO';
import { META_ENUMS, type MetaDTO } from '@basket/core/dtos/MetaDTO';

type RowAny = Record<string, unknown>;
const n = (v: unknown): number => (v == null ? 0 : Number(v));
const s = (v: unknown): string => (v == null ? '' : String(v));
const d = (v: unknown): string => {
  if (v == null) return '';
  if (v instanceof Date) return v.toISOString().slice(0, 10);
  return String(v).slice(0, 10);
};

// Reference "now" for analytics queries: yesterday end-of-day UTC.
// Today is excluded because mid-day sync would otherwise show a partial,
// distorted active count vs. fully-closed historical days.
function yesterdayEndUtc(): Date {
  const d = new Date();
  d.setUTCDate(d.getUTCDate() - 1);
  d.setUTCHours(23, 59, 59, 999);
  return d;
}

// Trend window start day (YYYY-MM-DD) given asOf day + optional range.
// Defaults to last 30 days. 'all' clamps at 2024-01-01 to keep generate_series sane.
function trendFromDay(day: string, range?: DateRange): string {
  if (!range) return shiftDay(day, -29);
  // Round-trip through Date: `from` is user input headed into raw SQL, so it
  // must come out as a strict YYYY-MM-DD or not at all.
  if (range.kind === 'custom') return shiftDay(range.from, 0);
  if (range.kind === 'yesterday') return day;
  if (range.kind === '7d') return shiftDay(day, -6);
  if (range.kind === '30d') return shiftDay(day, -29);
  if (range.kind === '90d') return shiftDay(day, -89);
  if (range.kind === 'ytd') return `${day.slice(0, 4)}-01-01`;
  return '2024-01-01';
}
function shiftDay(day: string, deltaDays: number): string {
  const d = new Date(`${day}T00:00:00Z`);
  d.setUTCDate(d.getUTCDate() + deltaDays);
  return d.toISOString().slice(0, 10);
}

// ── Contenido ───────────────────────────────────────────────────────────────
// The prototype's catalogue filter, and the two labels it needs. A row averaging
// under a minute of watching per view is a trailer, a test emission or an
// aborted stream; counting it as published content drags every average down.
const MIN_AVG_SECONDS_PER_VIEW = 60;
const CONTENT_NO_COUNTRY = 'OTROS';
// The first published match. Also the floor for an unbounded `from`, so one row
// mis-dated 2004 in the source cannot stretch every axis by sixteen years.
const CATALOGUE_FLOOR = '2020-10-01';
const TOP_TEAMS = 15;
const TOP_CONTENT = 15;
const TOP_EVENT_DAYS = 12;

/** A day headed into raw SQL: YYYY-MM-DD or nothing. */
function safeDay(v: string | undefined): string | null {
  if (!v || !/^\d{4}-\d{2}-\d{2}$/.test(v)) return null;
  const parsed = new Date(`${v}T00:00:00Z`);
  return Number.isNaN(parsed.getTime()) ? null : v;
}

function rangeBounds(r: DateRange): { from: Date; to: Date } {
  const to = yesterdayEndUtc();
  if (r.kind === 'custom') {
    return { from: new Date(r.from), to: new Date(r.to) };
  }
  // 'yesterday' is the single reference day: `from` stays on `to`'s day.
  const from = new Date(to);
  if (r.kind === '7d') from.setUTCDate(from.getUTCDate() - 6);
  else if (r.kind === '30d') from.setUTCDate(from.getUTCDate() - 30);
  else if (r.kind === '90d') from.setUTCDate(from.getUTCDate() - 90);
  else if (r.kind === 'ytd') from.setUTCMonth(0, 1);
  else if (r.kind === 'all') from.setUTCFullYear(2020, 0, 1);
  from.setUTCHours(0, 0, 0, 0);
  return { from, to };
}

// Lifecycle rows are monthly, so a range keeps every month it touches — a range
// landing mid-month keeps that whole month rather than dropping it.
function monthWindowWhere(r: DateRange | undefined): string {
  if (!r || r.kind === 'all') return '';
  const { from, to } = rangeBounds(r);
  const f = from.toISOString().slice(0, 10);
  const t = to.toISOString().slice(0, 10);
  return `WHERE month BETWEEN DATE_TRUNC('month', '${f}'::date)::date
                          AND DATE_TRUNC('month', '${t}'::date)::date`;
}

// The live lifecycle costs a pair of correlated counts per month, so the window
// is generated rather than filtered afterwards: only the asked-for months run.
// The upper bound is the last COMPLETE month, matching the mat view: the month
// in progress would report a whole month of expirations against a handful of
// days of renewals. A range that lies entirely inside the current month yields
// no months at all, which the tab renders as "sin datos".
function monthSeriesBounds(r: DateRange | undefined): string {
  const firstPaymentMonth = `(SELECT DATE_TRUNC('month', MIN(created_at))::date FROM payments)`;
  const lastCompleteMonth = `(DATE_TRUNC('month', CURRENT_DATE) - INTERVAL '1 month')::date`;
  if (!r || r.kind === 'all') {
    return `${firstPaymentMonth}, ${lastCompleteMonth}`;
  }
  const { from, to } = rangeBounds(r);
  const f = from.toISOString().slice(0, 10);
  const t = to.toISOString().slice(0, 10);
  return `GREATEST(${firstPaymentMonth}, DATE_TRUNC('month', '${f}'::date)::date),
                 LEAST(DATE_TRUNC('month', '${t}'::date)::date, ${lastCompleteMonth})`;
}

function toRetentionDTO(rows: unknown): RetentionDTO {
  const arr = ((rows as unknown) as RowAny[]).map((r) => ({
    month: d(r.month),
    activeStart: n(r.active_start),
    activeEnd: n(r.active_end),
    newPayers: n(r.new_payers),
    renewals: n(r.renewals),
    reactivations: n(r.reactivations),
    expirations: n(r.expirations),
    churnRatePct: n(r.churn_rate_pct),
    retentionRatePct: n(r.retention_rate_pct),
  }));
  const last = arr[arr.length - 1];
  return {
    rows: arr,
    latestChurnRatePct: last?.churnRatePct ?? null,
    latestRetentionRatePct: last?.retentionRatePct ?? null,
  };
}

const TRUNC: Record<Granularity, string> = {
  day: 'day',
  week: 'week',
  month: 'month',
};

const escStr = (str: string): string => str.replace(/'/g, "''");

function buildActiveFilterWhere(f?: CommonFilters): string {
  if (!hasFilters(f)) return '';
  const parts: string[] = [];
  if (f!.countries && f!.countries.length > 0) {
    const list = f!.countries.map((c) => `'${escStr(c)}'`).join(',');
    parts.push(`user_country IN (${list})`);
  }
  if (f!.accessType) parts.push(`access_type = '${escStr(f!.accessType)}'`);
  if (f!.subType) parts.push(`sub_type = '${escStr(f!.subType)}'`);
  return ` AND ${parts.join(' AND ')}`;
}

// The seam. These are the Providers whose fee mirror has rows: MercadoPago,
// whose Cobros Export is ingested from file, and Stripe, whose API is read on
// the cron. A Provider outside the list is absent from every net figure rather
// than present at zero — PayPal takes real money and has no fee feed at all, so
// including it would read as "PayPal costs nothing" instead of "we do not know".
//
// This list and `basket_mat_gateway_net_daily`'s own predicate must agree. They
// are two lines in two files, and a Provider added to one and not the other
// produces a total that is right on one path and wrong on the other.
const GATEWAY_PLATFORMS = [0, 4] as const;
const GATEWAY_PLATFORM_NAMES: Record<number, string> = { 0: 'MercadoPago', 4: 'Stripe' };
const GATEWAY_PLATFORM_LIST = GATEWAY_PLATFORMS.join(', ');
const gatewayName = (platform: number): string =>
  GATEWAY_PLATFORM_NAMES[platform] ?? `Platform ${platform}`;

// Subscriptions are Stripe's alone. MercadoPago's preapprovals are a different
// object with a different id shape (the 143,577 hex32 ids in basket_payments)
// and no fetcher yet, so widening the money seam above must NOT widen this one:
// counting MP subscriptions as zero would understate churn, not report it.
/** Providers with a subscription mirror: Stripe subscriptions and MercadoPago
 *  preapprovals, both in basket_gateway_subscriptions. */
const SUBSCRIPTION_PLATFORMS = '(0, 4)';

// The rolling comparison on /financiero: the last 30 days against the 30
// before. The daily series is fetched over both windows so the bajas of each
// can be summed off the same rows the 15-day chart reads.
const PERIOD_WINDOW_DAYS = 30;
/** Days of the daily lifecycle series to fetch: both windows, anchor included. */
const DAILY_SPAN = 2 * PERIOD_WINDOW_DAYS - 1;
/** Days the prototype's "últimos 15 días" charts show: the anchor and the 15 before it. */
const DAILY_CHART_DAYS = 15;

// GROUPING(day, month) bitmasks: bit set = column IS grouped away.
const GRP_DAY = 1; // day kept, month grouped   -> 01
const GRP_MONTH = 2; // day grouped, month kept -> 10
const GRP_TOTAL = 3; // both grouped            -> 11

// fee_amount / settlement_amount — same plane. Dividing a fee by a presentment
// gross reads 0.16% on a UYU row because the two numbers are in different
// currencies; that ratio is never computed anywhere.
function feePct(fees: number, grossSettlement: number): number {
  if (grossSettlement === 0) return 0;
  return Math.round((fees / grossSettlement) * 10000) / 100;
}

export class DrizzleAnalyticsQueryRepository implements IAnalyticsQueryRepository {
  constructor(private readonly conn: Db = db) {}

  // --------------------------------------------------------------------------
  // OVERVIEW — 1 mat view scan + 2 small queries, parallelized
  // --------------------------------------------------------------------------
  async getOverview(
    asOf: Date = yesterdayEndUtc(),
    range?: DateRange,
    filters?: CommonFilters,
  ): Promise<OverviewDTO> {
    const day = asOf.toISOString().slice(0, 10);
    const trendFrom = trendFromDay(day, range);
    if (hasFilters(filters)) {
      return this.getOverviewFiltered(day, trendFrom, filters!);
    }

    const [todayRows, trendRows, newPayersRows, revRows] = await Promise.all([
      this.conn.execute(sql.raw(`
        SELECT day, all_active, real_active, voucher_active, antel_active,
               free_active, mensual_basico_active, mensual_total_active, anual_total_active,
               uy_active, ar_active, cl_active, other_active
        FROM basket_mat_daily_active
        WHERE day = (SELECT MAX(day) FROM basket_mat_daily_active WHERE day <= '${day}'::date)
      `)),
      this.conn.execute(sql.raw(`
        SELECT day, all_active, real_active, voucher_active
        FROM basket_mat_daily_active
        WHERE day BETWEEN '${trendFrom}'::date AND '${day}'::date
        ORDER BY day
      `)),
      this.conn.execute(sql.raw(`
        SELECT COUNT(*)::int AS c
        FROM (
          SELECT user_id, MIN(created_at) AS first_at
          FROM basket_v_active_payments
          GROUP BY user_id
        ) f
        WHERE f.first_at >= '${trendFrom}'::date
          AND f.first_at <= '${day}'::date
      `)),
      this.conn.execute(sql.raw(`
        SELECT currency, SUM(total_amount)::numeric AS amount
        FROM basket_mat_revenue_daily
        WHERE day BETWEEN '${trendFrom}'::date AND '${day}'::date
        GROUP BY currency
        ORDER BY amount DESC
      `)),
    ]);

    const today = ((todayRows as unknown) as RowAny[])[0] ?? {};
    const all = n(today.all_active);

    const pct = (v: unknown): number =>
      all > 0 ? Math.round((n(v) / all) * 1000) / 10 : 0;

    const accessBreakdown: OverviewBreakdown[] = [
      { label: 'real',    count: n(today.real_active),    pct: pct(today.real_active) },
      { label: 'voucher', count: n(today.voucher_active), pct: pct(today.voucher_active) },
      { label: 'antel',   count: n(today.antel_active),   pct: pct(today.antel_active) },
    ];
    const subTypeBreakdown: OverviewBreakdown[] = [
      { label: 'Free',           count: n(today.free_active),           pct: pct(today.free_active) },
      { label: 'Mensual_Basico', count: n(today.mensual_basico_active), pct: pct(today.mensual_basico_active) },
      { label: 'Mensual_Total',  count: n(today.mensual_total_active),  pct: pct(today.mensual_total_active) },
      { label: 'Anual_Total',    count: n(today.anual_total_active),    pct: pct(today.anual_total_active) },
    ];
    const countryBreakdown: OverviewBreakdown[] = [
      { label: 'Uruguay',   count: n(today.uy_active),    pct: pct(today.uy_active) },
      { label: 'Argentina', count: n(today.ar_active),    pct: pct(today.ar_active) },
      { label: 'Chile',     count: n(today.cl_active),    pct: pct(today.cl_active) },
      { label: 'Other',     count: n(today.other_active), pct: pct(today.other_active) },
    ];

    const trend: OverviewTrendPoint[] = ((trendRows as unknown) as RowAny[]).map((r) => ({
      day: d(r.day),
      allActive: n(r.all_active),
      realActive: n(r.real_active),
      voucherActive: n(r.voucher_active),
    }));

    return {
      asOf: day,
      kpis: {
        activeAll: all,
        activeReal: n(today.real_active),
        activeVoucher: n(today.voucher_active),
        activeAntel: n(today.antel_active),
        activeFree: n(today.free_active),
        activeMensualBasico: n(today.mensual_basico_active),
        activeMensualTotal: n(today.mensual_total_active),
        activeAnualTotal: n(today.anual_total_active),
        newPayersInRange: n(((newPayersRows as unknown) as RowAny[])[0]?.c),
        revenueInRangeByCurrency: ((revRows as unknown) as RowAny[]).map((r) => ({
          currency: s(r.currency),
          amount: n(r.amount),
        })),
      },
      trend,
      accessBreakdown,
      subTypeBreakdown,
      countryBreakdown,
    };
  }

  // --------------------------------------------------------------------------
  // OVERVIEW (filtered) — live SQL on basket_v_active_payments
  // --------------------------------------------------------------------------
  private async getOverviewFiltered(day: string, trendFrom: string, filters: CommonFilters): Promise<OverviewDTO> {
    const fw = buildActiveFilterWhere(filters);

    const [todayRows, trendRows, newPayersRows, revRows] = await Promise.all([
      this.conn.execute(sql.raw(`
        WITH active AS (
          SELECT user_id, user_country, access_type, sub_type
          FROM basket_v_active_payments
          WHERE created_at < '${day}'::date + 1
            AND (expires_at + INTERVAL '7 days')::date >= '${day}'::date
            ${fw}
        )
        SELECT
          COUNT(DISTINCT user_id)::int AS all_active,
          COUNT(DISTINCT user_id) FILTER (WHERE access_type='real')::int    AS real_active,
          COUNT(DISTINCT user_id) FILTER (WHERE access_type='voucher')::int AS voucher_active,
          COUNT(DISTINCT user_id) FILTER (WHERE access_type='antel')::int   AS antel_active,
          COUNT(DISTINCT user_id) FILTER (WHERE sub_type='Free')::int            AS free_active,
          COUNT(DISTINCT user_id) FILTER (WHERE sub_type='Mensual_Basico')::int  AS mensual_basico_active,
          COUNT(DISTINCT user_id) FILTER (WHERE sub_type='Mensual_Total')::int   AS mensual_total_active,
          COUNT(DISTINCT user_id) FILTER (WHERE sub_type='Anual_Total')::int     AS anual_total_active,
          COUNT(DISTINCT user_id) FILTER (WHERE user_country='Uruguay')::int   AS uy_active,
          COUNT(DISTINCT user_id) FILTER (WHERE user_country='Argentina')::int AS ar_active,
          COUNT(DISTINCT user_id) FILTER (WHERE user_country='Chile')::int     AS cl_active,
          COUNT(DISTINCT user_id) FILTER (WHERE user_country IS NULL
                              OR user_country NOT IN ('Uruguay','Argentina','Chile'))::int AS other_active
        FROM active
      `)),
      // Same islands -> ±1 events -> running-sum construction as
      // getEvolutionFiltered, with only the 3 segments this trend charts.
      this.conn.execute(sql.raw(`
        WITH days AS (
          SELECT generate_series('${trendFrom}'::date, '${day}'::date, '1 day'::interval)::date AS d
        ),
        payments AS (
          SELECT user_id, created_at, expires_at, access_type
          FROM basket_v_active_payments
          WHERE created_at IS NOT NULL
            AND expires_at IS NOT NULL
            AND (expires_at + INTERVAL '7 days')::date >= created_at::date
            AND (expires_at + INTERVAL '7 days')::date >= '${trendFrom}'::date
            AND created_at < '${day}'::date + 1
            ${fw}
        ),
        segmented AS (
          SELECT seg, user_id,
                 created_at::date                       AS s,
                 (expires_at + INTERVAL '7 days')::date AS e
          FROM payments p
          CROSS JOIN LATERAL (VALUES ('all'), (p.access_type)) AS v(seg)
          WHERE seg IN ('all', 'real', 'voucher')
        ),
        -- Gaps-and-islands: a payment starting after the running max end + 1 day
        -- opens a new island, anything else extends the current one.
        marked AS (
          SELECT seg, user_id, s, e,
                 MAX(e) OVER (
                   PARTITION BY seg, user_id ORDER BY s
                   ROWS BETWEEN UNBOUNDED PRECEDING AND 1 PRECEDING
                 ) AS prev_max_e
          FROM segmented
        ),
        grouped AS (
          SELECT seg, user_id, s, e,
                 SUM(CASE WHEN prev_max_e IS NULL OR s > prev_max_e + 1 THEN 1 ELSE 0 END)
                   OVER (PARTITION BY seg, user_id ORDER BY s ROWS UNBOUNDED PRECEDING) AS island
          FROM marked
        ),
        islands AS (
          SELECT seg, MIN(s) AS s, MAX(e) AS e
          FROM grouped GROUP BY seg, user_id, island
        ),
        events AS (
          SELECT seg, s AS d,  1 AS delta FROM islands
          UNION ALL
          SELECT seg, e + 1   , -1        FROM islands
        ),
        -- Deltas before the window seed each series so the level starts at
        -- the real base instead of restarting at 0.
        seed AS (
          SELECT seg, SUM(delta)::int AS base
          FROM events WHERE d < '${trendFrom}'::date GROUP BY seg
        ),
        daily AS (
          SELECT seg, d, SUM(delta)::int AS delta
          FROM events
          WHERE d BETWEEN '${trendFrom}'::date AND '${day}'::date
          GROUP BY seg, d
        ),
        segs AS (SELECT DISTINCT seg FROM events),
        timeline AS (
          SELECT sg.seg, days.d,
                 COALESCE(se.base, 0)
                 + SUM(COALESCE(dl.delta, 0)) OVER (PARTITION BY sg.seg ORDER BY days.d) AS active
          FROM segs sg
          CROSS JOIN days
          LEFT JOIN seed  se ON se.seg = sg.seg
          LEFT JOIN daily dl ON dl.seg = sg.seg AND dl.d = days.d
        )
        SELECT
          days.d AS day,
          COALESCE(MAX(t.active) FILTER (WHERE t.seg = 'all'), 0)::int     AS all_active,
          COALESCE(MAX(t.active) FILTER (WHERE t.seg = 'real'), 0)::int    AS real_active,
          COALESCE(MAX(t.active) FILTER (WHERE t.seg = 'voucher'), 0)::int AS voucher_active
        FROM days
        LEFT JOIN timeline t ON t.d = days.d
        GROUP BY days.d
        ORDER BY days.d
      `)),
      this.conn.execute(sql.raw(`
        SELECT COUNT(*)::int AS c FROM (
          SELECT user_id, MIN(created_at) AS first_at
          FROM basket_v_active_payments
          WHERE 1=1 ${fw}
          GROUP BY user_id
        ) f
        WHERE f.first_at >= '${trendFrom}'::date
          AND f.first_at <= '${day}'::date
      `)),
      this.conn.execute(sql.raw(`
        SELECT currency, SUM(amount)::numeric AS amount
        FROM basket_v_active_payments
        WHERE created_at >= '${trendFrom}'::date
          AND created_at < '${day}'::date + 1
          AND amount > 0
          ${fw}
        GROUP BY currency
        ORDER BY amount DESC
      `)),
    ]);

    const today = ((todayRows as unknown) as RowAny[])[0] ?? {};
    const all = n(today.all_active);
    const pct = (v: unknown): number => (all > 0 ? Math.round((n(v) / all) * 1000) / 10 : 0);

    const accessBreakdown: OverviewBreakdown[] = [
      { label: 'real',    count: n(today.real_active),    pct: pct(today.real_active) },
      { label: 'voucher', count: n(today.voucher_active), pct: pct(today.voucher_active) },
      { label: 'antel',   count: n(today.antel_active),   pct: pct(today.antel_active) },
    ];
    const subTypeBreakdown: OverviewBreakdown[] = [
      { label: 'Free',           count: n(today.free_active),           pct: pct(today.free_active) },
      { label: 'Mensual_Basico', count: n(today.mensual_basico_active), pct: pct(today.mensual_basico_active) },
      { label: 'Mensual_Total',  count: n(today.mensual_total_active),  pct: pct(today.mensual_total_active) },
      { label: 'Anual_Total',    count: n(today.anual_total_active),    pct: pct(today.anual_total_active) },
    ];
    const countryBreakdown: OverviewBreakdown[] = [
      { label: 'Uruguay',   count: n(today.uy_active),    pct: pct(today.uy_active) },
      { label: 'Argentina', count: n(today.ar_active),    pct: pct(today.ar_active) },
      { label: 'Chile',     count: n(today.cl_active),    pct: pct(today.cl_active) },
      { label: 'Other',     count: n(today.other_active), pct: pct(today.other_active) },
    ];
    const trend: OverviewTrendPoint[] = ((trendRows as unknown) as RowAny[]).map((r) => ({
      day: d(r.day),
      allActive: n(r.all_active),
      realActive: n(r.real_active),
      voucherActive: n(r.voucher_active),
    }));

    return {
      asOf: day,
      kpis: {
        activeAll: all,
        activeReal: n(today.real_active),
        activeVoucher: n(today.voucher_active),
        activeAntel: n(today.antel_active),
        activeFree: n(today.free_active),
        activeMensualBasico: n(today.mensual_basico_active),
        activeMensualTotal: n(today.mensual_total_active),
        activeAnualTotal: n(today.anual_total_active),
        newPayersInRange: n(((newPayersRows as unknown) as RowAny[])[0]?.c),
        revenueInRangeByCurrency: ((revRows as unknown) as RowAny[]).map((r) => ({
          currency: s(r.currency),
          amount: n(r.amount),
        })),
      },
      trend,
      accessBreakdown,
      subTypeBreakdown,
      countryBreakdown,
    };
  }

  // --------------------------------------------------------------------------
  // EVOLUTION — single mat view scan, bucketed by DATE_TRUNC
  // --------------------------------------------------------------------------
  async getEvolution(
    range: DateRange,
    granularity: Granularity = 'day',
    filters?: CommonFilters,
  ): Promise<EvolutionDTO> {
    if (hasFilters(filters)) {
      return this.getEvolutionFiltered(range, granularity, filters!);
    }
    const { from, to } = rangeBounds(range);
    const trunc = TRUNC[granularity];

    const rows = await this.conn.execute(sql.raw(`
      SELECT
        DATE_TRUNC('${trunc}', day)::date AS bucket,
        MAX(all_active)             AS all_active,
        MAX(real_active)            AS real_active,
        MAX(voucher_active)         AS voucher_active,
        MAX(free_active)            AS free_active,
        MAX(mensual_basico_active)  AS mensual_basico_active,
        MAX(mensual_total_active)   AS mensual_total_active,
        MAX(anual_total_active)     AS anual_total_active
      FROM basket_mat_daily_active
      WHERE day BETWEEN '${from.toISOString().slice(0,10)}'::date
                    AND '${to.toISOString().slice(0,10)}'::date
      GROUP BY DATE_TRUNC('${trunc}', day)
      ORDER BY bucket
    `));

    return {
      range,
      granularity,
      series: ((rows as unknown) as RowAny[]).map((r) => ({
        bucket: d(r.bucket),
        allActive: n(r.all_active),
        realActive: n(r.real_active),
        voucherActive: n(r.voucher_active),
        freeActive: n(r.free_active),
        mensualBasicoActive: n(r.mensual_basico_active),
        mensualTotalActive: n(r.mensual_total_active),
        anualTotalActive: n(r.anual_total_active),
      })),
    };
  }

  // --------------------------------------------------------------------------
  // EVOLUTION (filtered) — live SQL: coverage intervals -> running totals.
  //
  // "Active on day X" is a distinct-user count over overlapping payment
  // intervals. Asking that per bucket means bucket x payment work; instead each
  // user's payments are merged into gap-free coverage islands once, turned into
  // +1/-1 events, and summed forward. Buckets then read the standing total at
  // their first day, which is the same question the pre-aggregated view answers.
  // --------------------------------------------------------------------------
  private async getEvolutionFiltered(
    range: DateRange,
    granularity: Granularity,
    filters: CommonFilters,
  ): Promise<EvolutionDTO> {
    const { from, to } = rangeBounds(range);
    const fw = buildActiveFilterWhere(filters);
    const trunc = TRUNC[granularity];
    const f = from.toISOString().slice(0, 10);
    const t = to.toISOString().slice(0, 10);

    const rows = await this.conn.execute(sql.raw(`
      WITH buckets AS (
        SELECT generate_series(
                 DATE_TRUNC('${trunc}', '${f}'::date)::date,
                 '${t}'::date,
                 '1 ${trunc}'::interval
               )::date AS b
      ),
      -- ~1k payments (mostly Free) expire before they start. A per-bucket
      -- predicate can never match them; an interval model would read them as
      -- coverage running backwards, so they are dropped up front.
      payments AS (
        SELECT user_id, created_at, expires_at, access_type, sub_type
        FROM basket_v_active_payments
        WHERE created_at IS NOT NULL
          AND expires_at IS NOT NULL
          AND (expires_at + INTERVAL '7 days')::date >= created_at::date
          -- Coverage is read inside the window only, so a payment that lapsed
          -- before it or starts after it can't move any bucket.
          AND (expires_at + INTERVAL '7 days')::date >= DATE_TRUNC('${trunc}', '${f}'::date)::date
          AND created_at::date <= '${t}'::date
          ${fw}
      ),
      -- One payment feeds the total and its two splits, so it is counted once
      -- per series it belongs to. 'antel' and 'Otros' have no series of their
      -- own: they reach the chart only through 'all'.
      segmented AS (
        SELECT seg, user_id,
               created_at::date                      AS s,
               (expires_at + INTERVAL '7 days')::date AS e
        FROM payments p
        CROSS JOIN LATERAL (VALUES ('all'), (p.access_type), (p.sub_type)) AS v(seg)
      ),
      -- Gaps-and-islands: a payment starting after the running max end + 1 day
      -- opens a new island, anything else extends the current one.
      marked AS (
        SELECT seg, user_id, s, e,
               MAX(e) OVER (
                 PARTITION BY seg, user_id ORDER BY s
                 ROWS BETWEEN UNBOUNDED PRECEDING AND 1 PRECEDING
               ) AS prev_max_e
        FROM segmented
      ),
      grouped AS (
        SELECT seg, user_id, s, e,
               SUM(CASE WHEN prev_max_e IS NULL OR s > prev_max_e + 1 THEN 1 ELSE 0 END)
                 OVER (PARTITION BY seg, user_id ORDER BY s ROWS UNBOUNDED PRECEDING) AS island
        FROM marked
      ),
      islands AS (
        SELECT seg, MIN(s) AS s, MAX(e) AS e
        FROM grouped GROUP BY seg, user_id, island
      ),
      events AS (
        SELECT seg, s AS d,  1 AS delta FROM islands
        UNION ALL
        SELECT seg, e + 1   , -1        FROM islands
      ),
      timeline AS (
        SELECT seg, d, SUM(SUM(delta)) OVER (PARTITION BY seg ORDER BY d) AS active
        FROM events GROUP BY seg, d
      )
      SELECT
        b.b AS bucket,
        COALESCE(MAX(t.active) FILTER (WHERE t.seg = 'all'), 0)::int            AS all_active,
        COALESCE(MAX(t.active) FILTER (WHERE t.seg = 'real'), 0)::int           AS real_active,
        COALESCE(MAX(t.active) FILTER (WHERE t.seg = 'voucher'), 0)::int        AS voucher_active,
        COALESCE(MAX(t.active) FILTER (WHERE t.seg = 'Free'), 0)::int           AS free_active,
        COALESCE(MAX(t.active) FILTER (WHERE t.seg = 'Mensual_Basico'), 0)::int AS mensual_basico_active,
        COALESCE(MAX(t.active) FILTER (WHERE t.seg = 'Mensual_Total'), 0)::int  AS mensual_total_active,
        COALESCE(MAX(t.active) FILTER (WHERE t.seg = 'Anual_Total'), 0)::int    AS anual_total_active
      FROM buckets b
      -- The standing total per series at the bucket's first day.
      LEFT JOIN LATERAL (
        SELECT DISTINCT ON (tl.seg) tl.seg, tl.active
        FROM timeline tl
        WHERE tl.d <= b.b
        ORDER BY tl.seg, tl.d DESC
      ) t ON TRUE
      GROUP BY b.b
      ORDER BY b.b
    `));

    return {
      range,
      granularity,
      series: ((rows as unknown) as RowAny[]).map((r) => ({
        bucket: d(r.bucket),
        allActive: n(r.all_active),
        realActive: n(r.real_active),
        voucherActive: n(r.voucher_active),
        freeActive: n(r.free_active),
        mensualBasicoActive: n(r.mensual_basico_active),
        mensualTotalActive: n(r.mensual_total_active),
        anualTotalActive: n(r.anual_total_active),
      })),
    };
  }

  // --------------------------------------------------------------------------
  // TEAMS — master list: fanbase size + Subscription movement per team
  //
  // Two independent halves, merged in memory:
  //   followers — every Subscriber whose promo_team_id is the team, paying or
  //               not, so it is never touched by the Subscription filters;
  //   movement  — altas/bajas/activeSubs/pagos, from basket_mat_team_daily when
  //               no CommonFilters are set, live from basket_v_active_payments
  //               when they are (the mat view has no access_type/sub_type/
  //               country split to filter on).
  //
  // Alta on day D = active on D, not active on D-1 (a new or reactivated
  // Subscriber, NOT a renewal). Baja on D = active on D-1, not on D. Active on D
  // = a Pago with created_at::date <= D and (expires_at + 7 days)::date >= D.
  // Because of that 7-day grace, bajas trail the real expiry by ~7 days.
  // Movement is attributed to the Subscriber's CURRENT promo team: someone who
  // changes favourite team takes their whole history with them. Team 0 is the
  // 'Sin equipo' bucket and is a first-class row here, not an exclusion.
  // --------------------------------------------------------------------------
  async getTeams(
    range: DateRange,
    opts: { limit?: number; country?: string; filters?: CommonFilters } = {},
  ): Promise<TeamsDTO> {
    const { limit = 50, country, filters } = opts;
    const { from, to } = rangeBounds(range);
    const f = d(from);
    const t = d(to);

    const [followerRows, movementRows] = await Promise.all([
      this.conn.execute(sql.raw(`
        SELECT COALESCE(u.promo_team_id, 0)             AS team_id,
               COALESCE(t.team_name, 'Sin equipo')      AS team_name,
               COALESCE(t.league, 'N/A')                AS league,
               COALESCE(t.country, 'N/A')               AS team_country,
               COUNT(*)::int                            AS followers,
               COUNT(*) FILTER (WHERE u.created_at::date BETWEEN '${f}'::date
                                                            AND '${t}'::date)::int AS new_followers
        FROM basket_users u
        LEFT JOIN basket_teams t ON t.id = u.promo_team_id
        ${country ? `WHERE COALESCE(t.country, 'N/A') = '${escStr(country)}'` : ''}
        GROUP BY 1, 2, 3, 4
      `)),
      hasFilters(filters)
        ? this.teamsMovementFiltered(f, t, country, filters!)
        : this.teamsMovementFromMatView(f, t, country),
    ]);

    const rows = new Map<number, TeamRankRow>();
    const row = (teamId: number): TeamRankRow => {
      let r = rows.get(teamId);
      if (!r) {
        r = {
          teamId, teamName: `#${teamId}`, league: 'N/A', teamCountry: 'N/A',
          followers: 0, newFollowers: 0, activeSubs: 0,
          altas: 0, bajas: 0, net: 0,
          payments: 0, amount: 0, uniquePayers: 0,
        };
        rows.set(teamId, r);
      }
      return r;
    };

    for (const r of ((followerRows as unknown) as RowAny[])) {
      const team = row(n(r.team_id));
      team.teamName = s(r.team_name);
      team.league = s(r.league);
      team.teamCountry = s(r.team_country);
      team.followers = n(r.followers);
      team.newFollowers = n(r.new_followers);
    }
    for (const r of movementRows) {
      const team = row(n(r.team_id));
      team.activeSubs = n(r.active_subs);
      team.altas = n(r.altas);
      team.bajas = n(r.bajas);
      team.net = team.altas - team.bajas;
      team.payments = n(r.payments);
      team.amount = n(r.amount);
      team.uniquePayers = n(r.unique_payers);
    }

    const all = [...rows.values()].sort((a, b) => b.followers - a.followers);
    const sum = (pick: (r: TeamRankRow) => number): number =>
      all.reduce((acc, r) => acc + pick(r), 0);
    const altas = sum((r) => r.altas);
    const bajas = sum((r) => r.bajas);

    return {
      range,
      from: f,
      to: t,
      totals: {
        teams: all.length,
        followers: sum((r) => r.followers),
        // Each Subscriber has exactly one favourite team, so team sums don't overlap.
        activeSubs: sum((r) => r.activeSubs),
        altas,
        bajas,
        net: altas - bajas,
        teamsWithMovement: all.filter((r) => r.altas + r.bajas > 0).length,
      },
      ranked: all.slice(0, limit),
    };
  }

  // Unfiltered movement: cumulative-sum `delta` over the window, seeded by the
  // sum of every delta strictly before it — without that seed the level would
  // restart at 0 instead of the Subscription base the window inherits.
  // `unique_payers` is summed per day, so it is a per-day distinct count rolled
  // up, not a window-wide distinct Subscriber count (the mat view cannot give one).
  private async teamsMovementFromMatView(
    f: string,
    t: string,
    country?: string,
  ): Promise<RowAny[]> {
    const cf = country ? `AND team_country = '${escStr(country)}'` : '';
    const rows = await this.conn.execute(sql.raw(`
      WITH win AS (
        SELECT team_id,
               SUM(altas)::int         AS altas,
               SUM(bajas)::int         AS bajas,
               SUM(delta)::int         AS delta_win,
               SUM(payments)::int      AS payments,
               SUM(amount)::numeric    AS amount,
               SUM(unique_payers)::int AS unique_payers
        FROM basket_mat_team_daily
        WHERE day BETWEEN '${f}'::date AND '${t}'::date ${cf}
        GROUP BY team_id
      ),
      seed AS (
        SELECT team_id, SUM(delta)::int AS base
        FROM basket_mat_team_daily
        WHERE day < '${f}'::date ${cf}
        GROUP BY team_id
      ),
      universe AS (
        SELECT team_id FROM win
        UNION
        SELECT team_id FROM seed
      )
      SELECT u.team_id,
             COALESCE(w.altas, 0)                            AS altas,
             COALESCE(w.bajas, 0)                            AS bajas,
             COALESCE(w.payments, 0)                         AS payments,
             COALESCE(w.amount, 0)                           AS amount,
             COALESCE(w.unique_payers, 0)                    AS unique_payers,
             (COALESCE(s.base, 0) + COALESCE(w.delta_win, 0)) AS active_subs
      FROM universe u
      LEFT JOIN win w  ON w.team_id = u.team_id
      LEFT JOIN seed s ON s.team_id = u.team_id
    `));
    return (rows as unknown) as RowAny[];
  }

  // Filtered movement: same semantics computed live. Each Subscriber's Pago
  // spans are merged into islands of uninterrupted access (7-day grace); an
  // island start is an alta, the day after an island end is a baja. Islands are
  // built over full history — no window truncation — so an alta is genuinely a
  // new or reactivated Subscriber, never a window-edge artefact.
  private async teamsMovementFiltered(
    f: string,
    t: string,
    country: string | undefined,
    filters: CommonFilters,
  ): Promise<RowAny[]> {
    const fw = buildActiveFilterWhere(filters);
    const cf = country ? `AND team_country = '${escStr(country)}'` : '';
    const rows = await this.conn.execute(sql.raw(`
      WITH spans AS (
        SELECT v.user_id, COALESCE(v.team_id, 0) AS team_id,
               v.created_at::date AS s,
               (v.expires_at + INTERVAL '7 days')::date AS e
        FROM basket_v_active_payments v
        -- Pagos whose expires_at precedes their own created_at are active on no
        -- day, so they must yield neither alta nor baja. Same guard as the mat
        -- view; without it their baja predates their alta.
        WHERE (v.expires_at + INTERVAL '7 days')::date >= v.created_at::date
          ${fw} ${cf}
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
      agg AS (
        SELECT team_id, d, SUM(alta)::int AS altas, SUM(baja)::int AS bajas,
               SUM(alta - baja)::int AS delta
        FROM ev GROUP BY team_id, d
      ),
      win AS (
        SELECT team_id, SUM(altas)::int AS altas, SUM(bajas)::int AS bajas,
               SUM(delta)::int AS delta_win
        FROM agg WHERE d BETWEEN '${f}'::date AND '${t}'::date
        GROUP BY team_id
      ),
      seed AS (
        SELECT team_id, SUM(delta)::int AS base
        FROM agg WHERE d < '${f}'::date
        GROUP BY team_id
      ),
      money AS (
        SELECT COALESCE(team_id, 0) AS team_id,
               COUNT(*)::int                AS payments,
               COALESCE(SUM(amount), 0)     AS amount,
               COUNT(DISTINCT user_id)::int AS unique_payers
        FROM basket_v_active_payments
        WHERE created_at >= '${f}'::date AND created_at < '${t}'::date + 1 ${fw} ${cf}
        GROUP BY 1
      ),
      universe AS (
        SELECT team_id FROM win
        UNION SELECT team_id FROM seed
        UNION SELECT team_id FROM money
      )
      SELECT u.team_id,
             COALESCE(w.altas, 0)                             AS altas,
             COALESCE(w.bajas, 0)                             AS bajas,
             COALESCE(m.payments, 0)                          AS payments,
             COALESCE(m.amount, 0)                            AS amount,
             COALESCE(m.unique_payers, 0)                     AS unique_payers,
             (COALESCE(s.base, 0) + COALESCE(w.delta_win, 0)) AS active_subs
      FROM universe u
      LEFT JOIN win   w ON w.team_id = u.team_id
      LEFT JOIN seed  s ON s.team_id = u.team_id
      LEFT JOIN money m ON m.team_id = u.team_id
    `));
    return (rows as unknown) as RowAny[];
  }

  // --------------------------------------------------------------------------
  // TEAM DAILY — one team's dense altas/bajas/activeSubs series over the window
  // --------------------------------------------------------------------------
  async getTeamDaily(
    teamId: number,
    range: DateRange,
    filters?: CommonFilters,
  ): Promise<TeamDailyDTO> {
    const id = Number(teamId);
    const { from, to } = rangeBounds(range);
    const f = d(from);
    const t = d(to);

    const [nameRows, seriesRows] = await Promise.all([
      this.conn.execute(sql.raw(`
        SELECT COALESCE(t.team_name, 'Sin equipo') AS team_name
        FROM (SELECT ${id}::int AS id) x
        LEFT JOIN basket_teams t ON t.id = x.id
      `)),
      hasFilters(filters)
        ? this.teamDailyFiltered(id, f, t, filters!)
        : this.teamDailyFromMatView(id, f, t),
    ]);

    const days: string[] = [];
    const altas: number[] = [];
    const bajas: number[] = [];
    const activeSubs: number[] = [];
    for (const r of seriesRows) {
      days.push(d(r.day));
      altas.push(n(r.altas));
      bajas.push(n(r.bajas));
      activeSubs.push(n(r.active_subs));
    }

    return {
      teamId: id,
      teamName: s(((nameRows as unknown) as RowAny[])[0]?.team_name ?? 'Sin equipo'),
      from: f,
      to: t,
      days,
      altas,
      bajas,
      activeSubs,
    };
  }

  // generate_series makes the series dense; the running sum of `delta` is seeded
  // with every delta before the window so the level starts at the real base.
  private async teamDailyFromMatView(id: number, f: string, t: string): Promise<RowAny[]> {
    const rows = await this.conn.execute(sql.raw(`
      WITH days AS (
        SELECT generate_series('${f}'::date, '${t}'::date, INTERVAL '1 day')::date AS d
      ),
      seed AS (
        SELECT COALESCE(SUM(delta), 0)::int AS base
        FROM basket_mat_team_daily
        WHERE team_id = ${id} AND day < '${f}'::date
      ),
      win AS (
        SELECT day, altas, bajas, delta
        FROM basket_mat_team_daily
        WHERE team_id = ${id} AND day BETWEEN '${f}'::date AND '${t}'::date
      )
      SELECT days.d                                            AS day,
             COALESCE(w.altas, 0)::int                         AS altas,
             COALESCE(w.bajas, 0)::int                         AS bajas,
             (seed.base
              + SUM(COALESCE(w.delta, 0)) OVER (ORDER BY days.d))::int AS active_subs
      FROM days
      CROSS JOIN seed
      LEFT JOIN win w ON w.day = days.d
      ORDER BY days.d
    `));
    return (rows as unknown) as RowAny[];
  }

  // Same island construction as teamsMovementFiltered, restricted to one team.
  // Restricting the spans up front is safe: team_id in the view is the
  // Subscriber's current promo team, constant across all of their Pagos.
  private async teamDailyFiltered(
    id: number,
    f: string,
    t: string,
    filters: CommonFilters,
  ): Promise<RowAny[]> {
    const fw = buildActiveFilterWhere(filters);
    const rows = await this.conn.execute(sql.raw(`
      WITH spans AS (
        SELECT v.user_id,
               v.created_at::date AS s,
               (v.expires_at + INTERVAL '7 days')::date AS e
        FROM basket_v_active_payments v
        -- See getTeams: a Pago expiring before it was created is active on no day.
        WHERE COALESCE(v.team_id, 0) = ${id}
          AND (v.expires_at + INTERVAL '7 days')::date >= v.created_at::date
          ${fw}
      ),
      ord AS (
        SELECT user_id, s, e,
               MAX(e) OVER (PARTITION BY user_id ORDER BY s
                            ROWS BETWEEN UNBOUNDED PRECEDING AND 1 PRECEDING) AS prev_max
        FROM spans
      ),
      grp AS (
        SELECT user_id, s, e,
               SUM(CASE WHEN prev_max IS NULL OR s > prev_max + 1 THEN 1 ELSE 0 END)
                 OVER (PARTITION BY user_id ORDER BY s) AS island
        FROM ord
      ),
      islands AS (
        SELECT user_id, MIN(s) AS s, MAX(e) AS e
        FROM grp GROUP BY user_id, island
      ),
      ev AS (
        SELECT s     AS d, 1 AS alta, 0 AS baja FROM islands
        UNION ALL
        SELECT e + 1 AS d, 0 AS alta, 1 AS baja FROM islands
      ),
      agg AS (
        SELECT d, SUM(alta)::int AS altas, SUM(baja)::int AS bajas,
               SUM(alta - baja)::int AS delta
        FROM ev GROUP BY d
      ),
      days AS (
        SELECT generate_series('${f}'::date, '${t}'::date, INTERVAL '1 day')::date AS d
      ),
      seed AS (
        SELECT COALESCE(SUM(delta), 0)::int AS base FROM agg WHERE d < '${f}'::date
      )
      SELECT days.d                                            AS day,
             COALESCE(a.altas, 0)::int                         AS altas,
             COALESCE(a.bajas, 0)::int                         AS bajas,
             (seed.base
              + SUM(COALESCE(a.delta, 0)) OVER (ORDER BY days.d))::int AS active_subs
      FROM days
      CROSS JOIN seed
      LEFT JOIN agg a ON a.d = days.d
      ORDER BY days.d
    `));
    return (rows as unknown) as RowAny[];
  }

  // --------------------------------------------------------------------------
  // FINANCE — 4 aggregations against mat_revenue_daily in parallel
  // --------------------------------------------------------------------------
  // Gross only, unchanged: /financiero owns the net half and asks for it
  // separately, so the /basket tab keeps paying for exactly the four queries it
  // renders.
  async getFinance(range: DateRange, filters?: CommonFilters): Promise<FinanceDTO> {
    if (hasFilters(filters)) {
      return this.getFinanceFiltered(range, filters!);
    }
    return this.getFinanceGross(range);
  }

  private async getFinanceGross(range: DateRange): Promise<FinanceDTO> {
    const { from, to } = rangeBounds(range);
    const f = from.toISOString().slice(0, 10);
    const t = to.toISOString().slice(0, 10);
    const where = `WHERE day BETWEEN '${f}'::date AND '${t}'::date`;

    const [byDayRows, byPlatRows, byCurRows, platMoRows] = await Promise.all([
      this.conn.execute(sql.raw(`
        SELECT day, currency,
               SUM(total_amount)::numeric AS total_amount,
               SUM(real_amount)::numeric  AS real_amount,
               SUM(payment_count)::int    AS payment_count
        FROM basket_mat_revenue_daily ${where}
        GROUP BY day, currency ORDER BY day, currency
      `)),
      this.conn.execute(sql.raw(`
        SELECT platform, platform_name,
               SUM(payment_count)::int    AS payment_count,
               SUM(total_amount)::numeric AS total_amount,
               SUM(real_count)::int       AS real_count,
               SUM(real_amount)::numeric  AS real_amount
        FROM basket_mat_revenue_daily ${where}
        GROUP BY platform, platform_name ORDER BY total_amount DESC
      `)),
      this.conn.execute(sql.raw(`
        SELECT currency,
               SUM(total_amount)::numeric AS total_amount,
               SUM(payment_count)::int    AS payment_count
        FROM basket_mat_revenue_daily ${where}
        GROUP BY currency ORDER BY total_amount DESC
      `)),
      this.conn.execute(sql.raw(`
        SELECT DATE_TRUNC('month', day)::date AS month,
               platform_name,
               SUM(total_amount)::numeric    AS total_amount
        FROM basket_mat_revenue_daily ${where}
        GROUP BY DATE_TRUNC('month', day), platform_name
        ORDER BY month, platform_name
      `)),
    ]);

    return {
      range,
      revenueByDay: ((byDayRows as unknown) as RowAny[]).map((r) => ({
        day: d(r.day),
        currency: s(r.currency),
        totalAmount: n(r.total_amount),
        realAmount: n(r.real_amount),
        paymentCount: n(r.payment_count),
      })),
      byPlatform: ((byPlatRows as unknown) as RowAny[]).map((r) => ({
        platform: n(r.platform),
        platformName: s(r.platform_name),
        paymentCount: n(r.payment_count),
        totalAmount: n(r.total_amount),
        realCount: n(r.real_count),
        realAmount: n(r.real_amount),
      })),
      byCurrency: ((byCurRows as unknown) as RowAny[]).map((r) => ({
        currency: s(r.currency),
        totalAmount: n(r.total_amount),
        paymentCount: n(r.payment_count),
      })),
      platformMonthly: ((platMoRows as unknown) as RowAny[]).map((r) => ({
        month: d(r.month),
        platformName: s(r.platform_name),
        totalAmount: n(r.total_amount),
      })),
    };
  }

  // --------------------------------------------------------------------------
  // FINANCE (filtered) — live SQL on basket_v_active_payments
  // --------------------------------------------------------------------------
  private async getFinanceFiltered(
    range: DateRange,
    filters: CommonFilters,
  ): Promise<FinanceDTO> {
    const { from, to } = rangeBounds(range);
    const f = from.toISOString().slice(0, 10);
    const t = to.toISOString().slice(0, 10);
    const fw = buildActiveFilterWhere(filters);
    // Half-open range keeps the predicate sargable on created_at.
    const where = `WHERE created_at >= '${f}'::date AND created_at < '${t}'::date + 1 ${fw}`;

    // One scan of the view (materialized CTE), then GROUPING SETS produces the
    // four aggregations at once. grp is a GROUPING() bitmask over
    // (day, month, currency, platform, platform_name) that tags each set
    // unambiguously: 0 in a bit position means that column is grouped.
    const rows = await this.conn.execute(sql.raw(`
      WITH base AS MATERIALIZED (
        SELECT created_at::date AS day,
               DATE_TRUNC('month', created_at)::date AS month,
               currency, platform, platform_name, access_type, amount
        FROM basket_v_active_payments ${where}
      )
      SELECT GROUPING(day, month, currency, platform, platform_name)::int AS grp,
             day, month, currency, platform, platform_name,
             COUNT(*)::int AS payment_count,
             SUM(amount)::numeric AS total_amount,
             COUNT(*) FILTER (WHERE access_type='real')::int AS real_count,
             SUM(CASE WHEN access_type='real' THEN amount ELSE 0 END)::numeric AS real_amount
      FROM base
      GROUP BY GROUPING SETS (
        (day, currency),
        (platform, platform_name),
        (currency),
        (month, platform_name)
      )
    `));

    // Bitmask values (bit set = column NOT grouped), for (day, month, currency, platform, platform_name):
    //   (day, currency)            -> 01011 = 11
    //   (platform, platform_name)  -> 11100 = 28
    //   (currency)                 -> 11011 = 27
    //   (month, platform_name)     -> 10110 = 22
    const all = (rows as unknown) as RowAny[];
    const byDayRows = all
      .filter((r) => n(r.grp) === 11)
      .sort((a, b) => (d(a.day) < d(b.day) ? -1 : d(a.day) > d(b.day) ? 1 : s(a.currency) < s(b.currency) ? -1 : s(a.currency) > s(b.currency) ? 1 : 0));
    const byPlatRows = all
      .filter((r) => n(r.grp) === 28)
      .sort((a, b) => n(b.total_amount) - n(a.total_amount));
    const byCurRows = all
      .filter((r) => n(r.grp) === 27)
      .sort((a, b) => n(b.total_amount) - n(a.total_amount));
    const platMoRows = all
      .filter((r) => n(r.grp) === 22)
      .sort((a, b) => (d(a.month) < d(b.month) ? -1 : d(a.month) > d(b.month) ? 1 : s(a.platform_name) < s(b.platform_name) ? -1 : s(a.platform_name) > s(b.platform_name) ? 1 : 0));

    return {
      range,
      revenueByDay: ((byDayRows as unknown) as RowAny[]).map((r) => ({
        day: d(r.day),
        currency: s(r.currency),
        totalAmount: n(r.total_amount),
        realAmount: n(r.real_amount),
        paymentCount: n(r.payment_count),
      })),
      byPlatform: ((byPlatRows as unknown) as RowAny[]).map((r) => ({
        platform: n(r.platform),
        platformName: s(r.platform_name),
        paymentCount: n(r.payment_count),
        totalAmount: n(r.total_amount),
        realCount: n(r.real_count),
        realAmount: n(r.real_amount),
      })),
      byCurrency: ((byCurRows as unknown) as RowAny[]).map((r) => ({
        currency: s(r.currency),
        totalAmount: n(r.total_amount),
        paymentCount: n(r.payment_count),
      })),
      platformMonthly: ((platMoRows as unknown) as RowAny[]).map((r) => ({
        month: d(r.month),
        platformName: s(r.platform_name),
        totalAmount: n(r.total_amount),
      })),
    };
  }

  // --------------------------------------------------------------------------
  // ECONOMÍA (/financiero) — gross off our own Pagos, net off the gateway
  // mirrors. Two independent halves of the same page, so they run in parallel.
  //
  // The gross half reads basket_v_active_payments rather than the pre-aggregated
  // view for everything that needs a distinct payer count or a price point,
  // because the view aggregates both away. monthlyGross still comes off the view
  // when no filter is active — it is the one query here that is asked on every
  // range and the view answers it for free.
  // --------------------------------------------------------------------------
  async getEconomia(range: DateRange, filters?: CommonFilters): Promise<EconomiaDTO> {
    const { from, to } = rangeBounds(range);
    const f = from.toISOString().slice(0, 10);
    const t = to.toISOString().slice(0, 10);
    const fw = buildActiveFilterWhere(filters);
    // Half-open on created_at keeps the predicate sargable.
    const live = `WHERE created_at >= '${f}'::date AND created_at < '${t}'::date + 1 ${fw}`;

    // Sporting season, Sep→Aug: a Pago in Jan 2026 belongs to season 2025/26.
    // The prototype labels seasons by their opening year; this keeps both halves
    // of the label so nobody has to know that convention to read the chart.
    const season = `
      CASE WHEN EXTRACT(MONTH FROM created_at) >= 9
        THEN EXTRACT(YEAR FROM created_at)::int || '/' || RIGHT((EXTRACT(YEAR FROM created_at)::int + 1)::text, 2)
        ELSE (EXTRACT(YEAR FROM created_at)::int - 1) || '/' || RIGHT(EXTRACT(YEAR FROM created_at)::text, 2)
      END`;

    // Country, month-detail and catálogo all need a distinct payer count or a
    // price point, which the pre-aggregated view has aggregated away — so they
    // read the live view. One scan, three grains: as three separate queries this
    // walked 400k rows three times and cost 5s on range=all.
    //
    // grp is GROUPING(month, country, price, currency, plan_frequency): a bit
    // set means that column is grouped away, which tags each set unambiguously.
    //   (country, currency)                        -> 10101 = 21
    //   (month, currency)                          -> 01101 = 13
    //   (family, frequency, country, ccy, season, price) -> 10000 = 16
    //   (month, plan_frequency)                    -> 01110 = 14
    //   ()                                         -> 11111 = 31
    const groupedLive = this.conn.execute(sql.raw(`
      WITH base AS MATERIALIZED (
        SELECT
          DATE_TRUNC('month', created_at)::date AS month,
          -- 'N/A' rather than NULL for a Pago whose Subscriber has no country,
          -- matching basket_mat_revenue_daily so the two paths label it the same.
          COALESCE(user_country, 'N/A')         AS country,
          -- Matches basket_mat_revenue_daily, which coalesces the same way: a
          -- Pago with no currency is a voucher, and 'NONE' says so.
          COALESCE(currency, 'NONE')            AS currency,
          user_id,
          amount,
          CASE
            WHEN sub_type = 'Mensual_Basico' THEN 'Básico'
            WHEN sub_type IN ('Mensual_Total', 'Anual_Total') THEN 'Total'
            ELSE sub_type
          END                                   AS plan_family,
          CASE
            WHEN sub_type LIKE 'Mensual%' THEN 'Mensual'
            WHEN sub_type LIKE 'Anual%'   THEN 'Anual'
            WHEN recurrent = 0            THEN 'Free'
            ELSE 'Otros'
          END                                   AS plan_frequency,
          ${season}                             AS season
        FROM basket_v_active_payments ${live}
      )
      SELECT GROUPING(month, country, amount, currency, plan_frequency)::int AS grp,
             month, country, currency, plan_family, plan_frequency, season,
             amount::numeric              AS price,
             SUM(amount)::numeric         AS gross,
             COUNT(*)::int                AS tx_count,
             COUNT(DISTINCT user_id)::int AS payers,
             COUNT(DISTINCT country) FILTER (WHERE country <> 'N/A')::int AS countries
      FROM base
      GROUP BY GROUPING SETS (
        (country, currency),
        (month, currency),
        (plan_family, plan_frequency, country, currency, season, amount),
        (month, plan_frequency),
        ()
      )
    `));

    // The anchor every lifecycle figure hangs from, read once here so the
    // rolling windows and the Provider net they compare are cut at the same day.
    const asOf = await this.lifecycleAnchor();

    const [grossRows, liveRows, gateway, lifecycle, windowNet] = await Promise.all([
      hasFilters(filters)
        ? this.conn.execute(sql.raw(`
            SELECT DATE_TRUNC('month', created_at)::date AS month,
                   currency, platform_name,
                   SUM(amount)::numeric AS gross,
                   COUNT(*)::int        AS tx_count
            FROM basket_v_active_payments ${live}
            GROUP BY 1, 2, 3 ORDER BY 1, 2, 3
          `))
        : this.conn.execute(sql.raw(`
            SELECT DATE_TRUNC('month', day)::date AS month,
                   currency, platform_name,
                   SUM(total_amount)::numeric  AS gross,
                   SUM(payment_count)::int     AS tx_count
            FROM basket_mat_revenue_daily
            WHERE day BETWEEN '${f}'::date AND '${t}'::date
            GROUP BY 1, 2, 3 ORDER BY 1, 2, 3
          `)),
      groupedLive,
      this.getGatewayNet(range, filters),
      this.getSubscriberLifecycle(range, filters, asOf),
      this.windowNetUsd(asOf, filters),
    ]);

    const platformsWithGross = new Set(
      ((grossRows as unknown) as RowAny[]).map((r) => s(r.platform_name)),
    );
    const all = (liveRows as unknown) as RowAny[];
    const GRP_COUNTRY = 21;
    const GRP_MONTH = 13;
    const GRP_CATALOG = 16;
    const GRP_TOTALS = 31;
    const totalsRow = all.find((r) => n(r.grp) === GRP_TOTALS);
    // Both sides of the comparison were cut at `asOf`; the Provider net is
    // joined here because it comes from the fee mirror, not from Pagos.
    lifecycle.periodComparison.current.netUsdByPlatform = windowNet.current;
    lifecycle.periodComparison.previous.netUsdByPlatform = windowNet.previous;
    return {
      range,
      totals: {
        txCount: n(totalsRow?.tx_count),
        payers: n(totalsRow?.payers),
        countries: n(totalsRow?.countries),
      },
      // Anything we took money through but hold no fee rows for. Derived from
      // the range's own platforms, so a range with no MercadoPago Pagos does not
      // warn about MercadoPago.
      // Against the LIST, not the joined label: `platformName` is
      // 'MercadoPago · Stripe' once more than one Provider has fee rows, and
      // comparing a single name against that joined string matches nothing —
      // which would report every netted Provider as gross-only.
      grossOnlyPlatforms: [...platformsWithGross].filter(
        (p) => !gateway.platformNames.includes(p) && p !== 'Voucher' && p !== 'Manual',
      ),
      monthlyGross: ((grossRows as unknown) as RowAny[]).map((r) => ({
        month: d(r.month),
        currency: s(r.currency),
        platformName: s(r.platform_name),
        gross: n(r.gross),
        txCount: n(r.tx_count),
      })),
      byCountry: all
        .filter((r) => n(r.grp) === GRP_COUNTRY)
        .sort((a, b) => n(b.gross) - n(a.gross))
        .map((r) => ({
        country: s(r.country),
        currency: s(r.currency),
        gross: n(r.gross),
        txCount: n(r.tx_count),
        payers: n(r.payers),
      })),
      catalog: all
        .filter((r) => n(r.grp) === GRP_CATALOG)
        .sort((a, b) => n(b.tx_count) - n(a.tx_count))
        .map((r) => ({
        planFamily: s(r.plan_family),
        planFrequency: s(r.plan_frequency),
        market: s(r.country),
        currency: s(r.currency),
        season: s(r.season),
        price: n(r.price),
        txCount: n(r.tx_count),
      })),
      monthlyDetail: all
        .filter((r) => n(r.grp) === GRP_MONTH)
        .sort((a, b) => (d(a.month) < d(b.month) ? -1 : d(a.month) > d(b.month) ? 1 : s(a.currency) < s(b.currency) ? -1 : 1))
        .map((r) => ({
        month: d(r.month),
        currency: s(r.currency),
        gross: n(r.gross),
        txCount: n(r.tx_count),
        payers: n(r.payers),
      })),
      gateway,
      lifecycle,
    };
  }

  // --------------------------------------------------------------------------
  // SUBSCRIBER LIFECYCLE — altas, bajas and actives at day grain, off Pagos.
  //
  // One rule, used four times: a Subscriber is in the pool on a day when some
  // successful Pago has created_at ≤ day ≤ expires_at + 7 days. It is the rule
  // basket_mat_daily_active and every KPI already use, so an "active" here is
  // the same person an "active" is anywhere else on the screen.
  //
  // Everything is anchored at `asOf` — the last day with a Pago, capped at
  // yesterday — and not at today. Pagos arrive by Upload, so the days after the
  // last one hold no altas and every scheduled expiry: drawn to today, the pool
  // reads as collapsing at exactly the rate people were due to renew.
  // --------------------------------------------------------------------------
  /** The last day with a Pago, capped at yesterday — see the block comment above. */
  private async lifecycleAnchor(): Promise<string> {
    const [anchorRow] = ((await this.conn.execute(sql.raw(`
      SELECT LEAST(MAX(created_at)::date, CURRENT_DATE - 1)::text AS as_of
      FROM basket_v_active_payments
    `))) as unknown) as RowAny[];
    return s(anchorRow?.as_of) || yesterdayEndUtc().toISOString().slice(0, 10);
  }

  private async getSubscriberLifecycle(
    range: DateRange,
    filters: CommonFilters | undefined,
    asOf: string,
  ): Promise<SubscriberLifecycleDTO> {
    const a = `'${asOf}'::date`;
    const fw = buildActiveFilterWhere(filters);

    // Months the range touches, clamped to the anchor month — the same "keep
    // the whole month" rule monthWindowWhere applies to the Retención tab.
    const { from, to } = rangeBounds(range);
    const monthFrom = `DATE_TRUNC('month', '${from.toISOString().slice(0, 10)}'::date)::date`;
    const monthTo = `LEAST(DATE_TRUNC('month', '${to.toISOString().slice(0, 10)}'::date), DATE_TRUNC('month', ${a}))::date`;

    const liveStatuses = LIVE_STATUSES.map((st) => `'${escStr(st)}'`).join(', ');

    // The last-charge distribution has no Subscriber dimension, so it has no
    // filtered form: always the mirror's precomputed bridge (migration 0019),
    // aged at the anchor and restricted to the statuses the entity calls live.
    const lastChargeRowsP = this.conn.execute(sql.raw(`
      SELECT lc.platform,
        CASE WHEN lc.last_charge_at IS NULL THEN 'unknown'
             WHEN ${a} - lc.last_charge_at::date <= 30  THEN '0-30'
             WHEN ${a} - lc.last_charge_at::date <= 60  THEN '31-60'
             WHEN ${a} - lc.last_charge_at::date <= 90  THEN '61-90'
             WHEN ${a} - lc.last_charge_at::date <= 180 THEN '91-180'
             ELSE '180+' END AS bucket,
        COUNT(*)::int AS c
      FROM basket_mat_subscription_last_charge lc
      JOIN basket_gateway_subscriptions g
        ON g.platform = lc.platform AND g.subscription_id = lc.subscription_id
      WHERE lc.platform IN ${SUBSCRIPTION_PLATFORMS}
        AND g.status IN (${liveStatuses})
      GROUP BY 1, 2 ORDER BY 1, 2
    `));

    // Subscription Pagos per month by Period, for "Mensual vs Anual". Live on
    // both paths: the months view carries no Period, and this is one indexed
    // scan of the window with two counters, cheaper than widening the view.
    const monthFreqRowsP = this.conn.execute(sql.raw(`
      SELECT DATE_TRUNC('month', created_at)::date::text AS month,
             COUNT(*) FILTER (WHERE sub_type LIKE 'Mensual%')::int  AS mensual,
             COUNT(*) FILTER (WHERE sub_type = 'Anual_Total')::int   AS anual
      FROM basket_v_active_payments
      WHERE created_at >= ${monthFrom} AND created_at < ${monthTo} + INTERVAL '1 month'
        AND NOT (recurrent = 0 AND amount > 0) ${fw}
      GROUP BY 1
    `));

    // The rolling pair: Pagos of the last 30 days and of the 30 before, each
    // bucketed by what it meant for its Subscriber. The window CTE keeps every
    // Pago of the Subscribers who paid in those 60 days — the LAG needs a whole
    // history to tell a renewal from a reactivation — but on 60 days that is a
    // small slice of the table on either path, so this never reads a mat view.
    const W = PERIOD_WINDOW_DAYS;
    const windowTxRowsP = this.conn.execute(sql.raw(`
      WITH w(w, s, e) AS (
        VALUES ('current',  ${a} - ${W - 1},     ${a}),
               ('previous', ${a} - ${2 * W - 1}, ${a} - ${W})
      ),
      p AS (
        SELECT user_id, created_at, sub_type,
               (recurrent = 0 AND amount > 0) AS one_off,
               LAG(expires_at) OVER (PARTITION BY user_id ORDER BY created_at, id) AS prev_e,
               MIN(created_at) OVER (PARTITION BY user_id) AS first_at
        FROM basket_v_active_payments
        WHERE user_id IN (
          SELECT user_id FROM basket_v_active_payments
          WHERE created_at >= ${a} - ${2 * W - 1} AND created_at < ${a} + 1 ${fw}
        ) ${fw}
      )
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
    `));
    // The pool at the close of each window, split by Period and by family. Two
    // days against the Pagos that cover them — the expires_at index does the work.
    const windowActiveRowsP = this.conn.execute(sql.raw(`
      SELECT d.d::text AS day,
        COUNT(DISTINCT user_id)::int AS total,
        COUNT(DISTINCT user_id) FILTER (WHERE sub_type LIKE 'Mensual%')::int AS mensual,
        COUNT(DISTINCT user_id) FILTER (WHERE sub_type = 'Anual_Total')::int  AS anual,
        COUNT(DISTINCT user_id) FILTER (WHERE sub_type IN ('Mensual_Total', 'Anual_Total'))::int AS fam_total,
        COUNT(DISTINCT user_id) FILTER (WHERE sub_type = 'Mensual_Basico')::int AS fam_basico
      FROM (VALUES (${a}), (${a} - ${W})) d(d)
      JOIN basket_v_active_payments p
        ON p.created_at < d.d + 1 AND p.expires_at >= d.d - INTERVAL '7 days' ${fw}
      GROUP BY d.d
    `));

    const [dailyRows, monthlyRows, activeRows, lifetimeRows] = hasFilters(filters)
      ? await this.lifecycleLive(a, monthFrom, monthTo, fw)
      : await this.lifecycleFromMatViews(a, monthFrom, monthTo);
    const [lastChargeRows, monthFreqRows, windowTxRows, windowActiveRows] = await Promise.all([
      lastChargeRowsP, monthFreqRowsP, windowTxRowsP, windowActiveRowsP,
    ]);
    return this.toLifecycleDTO(asOf, {
      dailyRows, monthlyRows, activeRows, lastChargeRows, lifetimeRows,
      monthFreqRows, windowTxRows, windowActiveRows,
    });
  }

  /**
   * The Providers' net over the two rolling windows, converted to USD day by
   * day exactly as the range totals are. Its own read of the fee mirror, because
   * the range is the tab's and the windows are the anchor's: on "últimos 7 días"
   * the previous window lies entirely outside the range.
   */
  private async windowNetUsd(
    asOf: string,
    filters?: CommonFilters,
  ): Promise<Record<'current' | 'previous', PeriodWindow['netUsdByPlatform']>> {
    const W = PERIOD_WINDOW_DAYS;
    const from = shiftDay(asOf, -(2 * W - 1));
    const split = shiftDay(asOf, -W);
    const [moneyRows, fxRows] = await Promise.all([
      hasFilters(filters)
        ? this.gatewayMoneyFiltered(from, asOf, filters!)
        : this.gatewayMoneyUnfiltered(from, asOf),
      this.fxRates(from, asOf),
    ]);
    const days = ((moneyRows as unknown) as RowAny[])
      .filter((r) => s(r.grain) === 'settlement' && n(r.grp) === GRP_DAY)
      .map((r): NetDailyPoint => ({
        day: d(r.day),
        platform: n(r.platform),
        platformName: gatewayName(n(r.platform)),
        settlementCurrency: s(r.ccy),
        grossSettlement: n(r.gross),
        fees: n(r.fees),
        taxes: n(r.taxes),
        net: n(r.net),
        txCount: n(r.tx_count),
      }));
    const rates = indexRates(fxRows);
    // Per Provider, its settlement currencies added — two USD figures can be
    // summed, and a Provider settling in two currencies is still one Provider.
    // Null if any of them is null: a total short a currency is not a total.
    const perPlatform = (rows: NetDailyPoint[]): PeriodWindow['netUsdByPlatform'] => {
      const byPlatform = new Map<number, { platformName: string; netUsd: number | null }>();
      for (const t of usdTotals(rows, rates)) {
        const cur = byPlatform.get(t.platform) ?? { platformName: t.platformName, netUsd: 0 };
        cur.netUsd = cur.netUsd === null || t.netUsd === null ? null : cur.netUsd + t.netUsd;
        byPlatform.set(t.platform, cur);
      }
      return [...byPlatform.entries()]
        .map(([platform, v]) => ({ platform, ...v }))
        .sort((x, y) => x.platform - y.platform);
    };
    return {
      current: perPlatform(days.filter((r) => r.day > split)),
      previous: perPlatform(days.filter((r) => r.day <= split)),
    };
  }

  /** The fetched FX sources over a span of days — see getGatewayNet for why
   *  only these two, and docs/adr/0007 for what each one is. */
  private async fxRates(f: string, t: string): Promise<DailyRate[]> {
    const rows = (await this.conn.execute(sql.raw(`
      SELECT day::text AS day, quote_currency, source, rate::float8 AS rate
      FROM basket_fx_rates
      WHERE base_currency = 'USD'
        AND source IN ('blue', 'oficial_cross')
        AND day BETWEEN '${f}'::date AND '${t}'::date
    `))) as unknown as RowAny[];
    return rows.map((r): DailyRate => ({
      day: d(r.day),
      quoteCurrency: s(r.quote_currency),
      source: s(r.source),
      rate: n(r.rate),
    }));
  }

  /**
   * The unfiltered path: migration 0019's mat views, rebuilt at the end of
   * every Sync, so a request reads a few hundred rows instead of merging every
   * Subscriber's Pagos into coverage stretches on the spot (4–8 s live).
   */
  private lifecycleFromMatViews(a: string, monthFrom: string, monthTo: string) {
    const run = (q: string) => this.conn.execute(sql.raw(q));
    return Promise.all([
      run(`
        SELECT day::text AS day, new_subscribers, reactivated, churned, active
        FROM basket_mat_subscriber_days
        WHERE day BETWEEN ${a} - ${DAILY_SPAN} AND ${a}
        ORDER BY day
      `),
      run(`
        SELECT month::text AS month, one_off, new_subscribers, recurring, reactivated, churned
        FROM basket_mat_subscriber_months
        WHERE month BETWEEN ${monthFrom} AND ${monthTo}
        ORDER BY month
      `),
      // The close of a month is its last day, except for the anchor month,
      // which is measured at the anchor and flagged partial.
      run(`
        WITH months AS (
          SELECT m::date AS month,
                 LEAST((m + INTERVAL '1 month' - INTERVAL '1 day')::date, ${a}) AS d
          FROM generate_series(${monthFrom}, ${monthTo}, INTERVAL '1 month') m
        )
        SELECT months.month::text AS month,
               d.active         AS total,
               d.active_mensual AS mensual,
               d.active_anual   AS anual,
               d.active_otros   AS otros,
               (months.d = ${a}
                AND months.d <> (months.month + INTERVAL '1 month' - INTERVAL '1 day')::date) AS partial
        FROM months JOIN basket_mat_subscriber_days d ON d.day = months.d
        ORDER BY months.month
      `),
      run(`
        WITH closed AS (SELECT months FROM basket_mat_subscriber_lifetime WHERE last_covered < ${a})
        SELECT (SELECT COUNT(*) FROM closed)::int AS closed,
               (SELECT COUNT(*) FROM basket_mat_subscriber_lifetime WHERE last_covered >= ${a})::int AS open_,
               ROUND(AVG(months)::numeric, 1)::float8 AS mean,
               ROUND(percentile_cont(0.5)  WITHIN GROUP (ORDER BY months)::numeric, 1)::float8 AS median,
               ROUND(percentile_cont(0.25) WITHIN GROUP (ORDER BY months)::numeric, 1)::float8 AS p25,
               ROUND(percentile_cont(0.75) WITHIN GROUP (ORDER BY months)::numeric, 1)::float8 AS p75,
               ROUND(MAX(months)::numeric, 1)::float8 AS max
        FROM closed
      `),
    ]);
  }

  /**
   * The filtered path: the same figures computed live over the Pagos the filter
   * keeps. Each query is its mat view's definition with the filter pushed into
   * the base scan, so the two paths must agree on an empty filter — which
   * `pnpm smoke:lifecycle` checks.
   *
   * Four scans of the Pagos view in flight at once, beside getGatewayNet's
   * five. Postgres's parallel workers hand rows around through /dev/shm, and
   * this fan-out exhausted a container's 64 MB default ("could not resize
   * shared memory segment ... No space left on device"). Both compose files set
   * shm_size to 256 MB; a Postgres without it fails here first.
   */
  private lifecycleLive(a: string, monthFrom: string, monthTo: string, fw: string) {
    const run = (q: string) => this.conn.execute(sql.raw(q));
      // The 60 days ending at the anchor — both rolling windows; the chart
      // takes the last 16. Membership is one row per (day, Subscriber) with two
      // flags, so entering and leaving are one GROUP BY rather than four
      // correlated scans of the pool.
    const dailyRowsP = run(`
      WITH days AS (
        SELECT generate_series(${a} - ${DAILY_SPAN}, ${a}, INTERVAL '1 day')::date AS d
      ),
      cov AS (
        SELECT user_id, created_at::date AS s, (expires_at + INTERVAL '7 days')::date AS e
        FROM basket_v_active_payments
        -- Bounds on the raw columns, so the expires_at index is used. A Pago
        -- whose coverage ended before the window (grace and the day before the
        -- first day included) cannot change who is in the pool on any day of it.
        WHERE expires_at >= ${a} - INTERVAL '${DAILY_SPAN + 9} days'
          AND created_at < ${a} + 1 ${fw}
      ),
      -- Gaps and islands: a Subscriber's overlapping or abutting Pagos merge
      -- into one stretch of coverage, so entering the pool is the start of a
      -- stretch and leaving it is the day after its end. Islands of one
      -- Subscriber never overlap, so actives per day is a plain COUNT.
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
      -- The first Pago of a Subscriber's life, unfiltered on purpose: "pays for
      -- the first time" is about the person, not about the Tier being looked at.
      first_pago AS (
        SELECT user_id, MIN(created_at)::date AS f
        FROM basket_payments
        WHERE status = 1 AND user_id IN (SELECT user_id FROM islands)
        GROUP BY user_id
      )
      -- One join of days × islands that touch the day or the day before, so
      -- who entered, who left and who stayed come out of a single GROUP BY.
      SELECT d.d::text AS day,
        COUNT(*) FILTER (WHERE i.s = d.d AND f.f = d.d)::int    AS new_subscribers,
        COUNT(*) FILTER (WHERE i.s = d.d AND f.f < d.d)::int    AS reactivated,
        COUNT(*) FILTER (WHERE i.e = d.d - 1)::int              AS churned,
        COUNT(*) FILTER (WHERE i.s <= d.d AND i.e >= d.d)::int  AS active
      FROM days d
      LEFT JOIN islands i ON i.s <= d.d AND i.e >= d.d - 1
      LEFT JOIN first_pago f ON f.user_id = i.user_id
      GROUP BY d.d ORDER BY d.d
    `);
    // Pagos bucketed by what they meant for the Subscriber. `recurring` vs
      // `reactivated` splits on 37 days after the previous expiry, the threshold
      // basket_mat_monthly_lifecycle uses. A paid Pago with no recurring right
      // is a single match and gets its own bucket rather than an alta.
      //
      // `churned` is the Subscribers whose coverage ran out that month with no
      // later Pago overlapping it — the mat view's `expirations`, month by
      // month and up to the anchor. Derived from Pagos so every Provider counts;
      // the Providers' own dated cancellations are drawn one card over.
    const monthlyRowsP = run(`
        WITH p AS (
          SELECT user_id, created_at, expires_at, recurrent, amount,
                 (recurrent = 0 AND amount > 0) AS one_off,
                 LAG(expires_at) OVER (PARTITION BY user_id ORDER BY created_at, id) AS prev_e,
                 MIN(created_at) OVER (PARTITION BY user_id) AS first_at
          FROM basket_v_active_payments
          -- The window needs each Subscriber's whole history to know which Pago
          -- is their first and how far the previous one reached, but only for
          -- Subscribers who paid inside the window: on a 30-day range that is a
          -- tenth of the table.
          WHERE user_id IN (
            SELECT user_id FROM basket_v_active_payments
            WHERE created_at >= ${monthFrom} AND created_at < ${monthTo} + INTERVAL '1 month' ${fw}
          ) ${fw}
        ),
        buckets AS (
          SELECT DATE_TRUNC('month', created_at)::date AS m,
            COUNT(*) FILTER (WHERE one_off)::int AS one_off,
            COUNT(*) FILTER (WHERE NOT one_off AND created_at = first_at)::int AS new_subscribers,
            COUNT(*) FILTER (WHERE NOT one_off AND created_at <> first_at
                               AND created_at <= prev_e + INTERVAL '37 days')::int AS recurring,
            COUNT(*) FILTER (WHERE NOT one_off AND created_at <> first_at
                               AND created_at > prev_e + INTERVAL '37 days')::int AS reactivated
          FROM p
          WHERE created_at >= ${monthFrom} AND created_at < ${monthTo} + INTERVAL '1 month'
          GROUP BY 1
        ),
        lapsed AS (
          SELECT DATE_TRUNC('month', p1.expires_at + INTERVAL '7 days')::date AS m,
                 COUNT(DISTINCT p1.user_id)::int AS churned
          FROM basket_v_active_payments p1
          WHERE p1.expires_at < ${a} - INTERVAL '6 days'
            AND p1.expires_at >= ${monthFrom} - INTERVAL '7 days' ${fw}
            AND NOT EXISTS (
              SELECT 1 FROM basket_v_active_payments p2
              WHERE p2.user_id = p1.user_id
                AND p2.created_at <= p1.expires_at + INTERVAL '7 days'
                AND p2.expires_at > p1.expires_at
            )
          GROUP BY 1
        )
        SELECT COALESCE(b.m, l.m)::text AS month,
               COALESCE(b.one_off, 0)         AS one_off,
               COALESCE(b.new_subscribers, 0) AS new_subscribers,
               COALESCE(b.recurring, 0)       AS recurring,
               COALESCE(b.reactivated, 0)     AS reactivated,
               COALESCE(l.churned, 0)         AS churned
        FROM buckets b FULL OUTER JOIN lapsed l ON l.m = b.m
        ORDER BY 1
    `);
      // Distinct Subscribers in the pool at the close of each month. Each Pago
      // emits the month-ends it covers (one or two for a monthly Period, ~13 for
      // an annual one) and the count is DISTINCT per month-end, which beats
      // joining every month-end against every Pago by a factor of five. The
      // anchor month is measured at the anchor day and flagged partial.
    const activeRowsP = run(`
        WITH cov AS (
          SELECT user_id, sub_type, created_at::date AS s, (expires_at + INTERVAL '7 days')::date AS e
          FROM basket_v_active_payments
          WHERE expires_at >= ${monthFrom} - INTERVAL '7 days'
            AND created_at < LEAST(${monthTo} + INTERVAL '1 month', ${a} + 1) ${fw}
        ),
        me AS (
          SELECT c.user_id, c.sub_type, c.s, c.e,
                 DATE_TRUNC('month', m)::date AS month,
                 LEAST((m + INTERVAL '1 month' - INTERVAL '1 day')::date, ${a}) AS d
          FROM cov c,
               LATERAL generate_series(DATE_TRUNC('month', c.s),
                                       DATE_TRUNC('month', LEAST(c.e, ${a})),
                                       INTERVAL '1 month') m
        )
        SELECT month::text AS month,
               COUNT(DISTINCT user_id)::int AS total,
               COUNT(DISTINCT user_id) FILTER (WHERE sub_type LIKE 'Mensual%')::int AS mensual,
               COUNT(DISTINCT user_id) FILTER (WHERE sub_type = 'Anual_Total')::int AS anual,
               COUNT(DISTINCT user_id) FILTER (WHERE sub_type NOT LIKE 'Mensual%'
                                                 AND sub_type <> 'Anual_Total')::int AS otros,
               BOOL_OR(d = ${a} AND d <> (month + INTERVAL '1 month' - INTERVAL '1 day')::date) AS partial
        FROM me
        WHERE d >= s AND d <= e AND month BETWEEN ${monthFrom} AND ${monthTo}
        GROUP BY month ORDER BY month
    `);
    const lifetimeRowsP = run(`
        WITH per_user AS (
          SELECT user_id,
                 SUM(GREATEST(EXTRACT(EPOCH FROM (expires_at - created_at)), 0)) / 86400.0 / 30.0 AS months,
                 MAX((expires_at + INTERVAL '7 days')::date) AS last_e
          FROM basket_v_active_payments WHERE TRUE ${fw}
          GROUP BY user_id
        ),
        closed AS (SELECT months FROM per_user WHERE last_e < ${a})
        SELECT (SELECT COUNT(*) FROM closed)::int                          AS closed,
               (SELECT COUNT(*) FROM per_user WHERE last_e >= ${a})::int   AS open_,
               ROUND(AVG(months)::numeric, 1)::float8                      AS mean,
               ROUND(percentile_cont(0.5)  WITHIN GROUP (ORDER BY months)::numeric, 1)::float8 AS median,
               ROUND(percentile_cont(0.25) WITHIN GROUP (ORDER BY months)::numeric, 1)::float8 AS p25,
               ROUND(percentile_cont(0.75) WITHIN GROUP (ORDER BY months)::numeric, 1)::float8 AS p75,
               ROUND(MAX(months)::numeric, 1)::float8                      AS max
        FROM closed
    `);

    return Promise.all([dailyRowsP, monthlyRowsP, activeRowsP, lifetimeRowsP]);
  }

  private toLifecycleDTO(
    asOf: string,
    rows: {
      dailyRows: unknown;
      monthlyRows: unknown;
      activeRows: unknown;
      lastChargeRows: unknown;
      lifetimeRows: unknown;
      monthFreqRows: unknown;
      windowTxRows: unknown;
      windowActiveRows: unknown;
    },
  ): SubscriberLifecycleDTO {
    const dailyAll = ((rows.dailyRows as unknown) as RowAny[]).map((r) => ({
      day: d(r.day),
      newSubscribers: n(r.new_subscribers),
      reactivated: n(r.reactivated),
      churned: n(r.churned),
      net: n(r.new_subscribers) + n(r.reactivated) - n(r.churned),
      active: n(r.active),
    }));
    const [lt] = (rows.lifetimeRows as unknown) as RowAny[];
    const stat = (v: unknown): number | null => (v == null ? null : Number(v));

    const freqByMonth = new Map<string, { mensual: number; anual: number }>();
    for (const r of (rows.monthFreqRows as unknown) as RowAny[]) {
      freqByMonth.set(d(r.month), { mensual: n(r.mensual), anual: n(r.anual) });
    }

    const W = PERIOD_WINDOW_DAYS;
    const txRows = (rows.windowTxRows as unknown) as RowAny[];
    const actRows = (rows.windowActiveRows as unknown) as RowAny[];
    const window = (which: 'current' | 'previous'): PeriodWindow => {
      const end = which === 'current' ? asOf : shiftDay(asOf, -W);
      const start = shiftDay(end, -(W - 1));
      const tx = txRows.find((r) => s(r.w) === which);
      const act = actRows.find((r) => d(r.day) === end);
      const churned = dailyAll
        .filter((r) => r.day >= start && r.day <= end)
        .reduce((acc, r) => acc + r.churned, 0);
      const b = {
        newSubscribers: n(tx?.new_subscribers),
        recurring: n(tx?.recurring),
        reactivated: n(tx?.reactivated),
        oneOff: n(tx?.one_off),
      };
      return {
        start,
        end,
        tx: {
          ...b,
          churned,
          mensual: n(tx?.mensual),
          anual: n(tx?.anual),
          total: b.newSubscribers + b.recurring + b.reactivated + b.oneOff,
        },
        active: {
          total: n(act?.total),
          mensual: n(act?.mensual),
          anual: n(act?.anual),
          famTotal: n(act?.fam_total),
          famBasico: n(act?.fam_basico),
        },
        // Filled by getEconomia, which holds the fee mirror's side of the window.
        netUsdByPlatform: [],
      };
    };

    return {
      asOf,
      daily: dailyAll.slice(-(DAILY_CHART_DAYS + 1)),
      monthly: ((rows.monthlyRows as unknown) as RowAny[]).map((r) => ({
        month: d(r.month),
        newSubscribers: n(r.new_subscribers),
        recurring: n(r.recurring),
        reactivated: n(r.reactivated),
        oneOff: n(r.one_off),
        churned: n(r.churned),
        mensual: freqByMonth.get(d(r.month))?.mensual ?? 0,
        anual: freqByMonth.get(d(r.month))?.anual ?? 0,
      })),
      activeByMonth: ((rows.activeRows as unknown) as RowAny[]).map((r) => ({
        month: d(r.month),
        mensual: n(r.mensual),
        anual: n(r.anual),
        otros: n(r.otros),
        total: n(r.total),
        partial: Boolean(r.partial),
      })),
      lastCharge: ((rows.lastChargeRows as unknown) as RowAny[]).map((r) => ({
        platform: n(r.platform),
        platformName: gatewayName(n(r.platform)),
        bucket: s(r.bucket) as LastChargeBucket,
        count: n(r.c),
      })),
      lifetime: {
        closed: n(lt?.closed),
        open: n(lt?.open_),
        meanMonths: stat(lt?.mean),
        medianMonths: stat(lt?.median),
        p25Months: stat(lt?.p25),
        p75Months: stat(lt?.p75),
        maxMonths: stat(lt?.max),
      },
      periodComparison: {
        windowDays: W,
        current: window('current'),
        previous: window('previous'),
      },
    };
  }

  // --------------------------------------------------------------------------
  // CONTENIDO — the catalogue and its audience, off basket_content.
  //
  // Two clocks meet here and only one of them is ours. `basket_content.date` is
  // the match's own kickoff, and `basket_payments.created_at` is Argentina local
  // time stored as UTC (a 3-hour skew). The two are bucketed by month side by
  // side in the audience-vs-subscribers series, so a match played late on the
  // last night of a month can land a month away from the Pagos it drove. Named
  // here rather than corrected: shifting one clock to match the other would make
  // every figure disagree with the tables they came from.
  //
  // The catalogue filter is the prototype's, reproduced: published rows only,
  // and only those averaging at least a minute of watching per view. Without it
  // the row count is 25% higher and every average is dragged down by trailers
  // and aborted streams.
  // --------------------------------------------------------------------------
  async getContenido(opts: {
    from?: string;
    to?: string;
    country?: string;
  }): Promise<ContenidoDTO> {
    // Dates arrive from the query string, so they go through a strict parse
    // before reaching raw SQL. Absent means the whole catalogue.
    const f = safeDay(opts.from) ?? CATALOGUE_FLOOR;
    const t = safeDay(opts.to) ?? d(new Date());
    const country = opts.country?.trim() || null;
    const countryWhere = country
      ? `AND COALESCE(NULLIF(c.country, ''), '${CONTENT_NO_COUNTRY}') = '${country.replace(/'/g, "''")}'`
      : '';

    // Half-open on the upper bound keeps `date` sargable against
    // basket_content_date_idx.
    const scoped = `
      FROM basket_content c
      WHERE c.date >= '${f}'::date AND c.date < '${t}'::date + 1
      ${countryWhere}`;
    const KEPT = `c.status = 1 AND c.views > 0
                  AND c.views_seconds::numeric / c.views >= ${MIN_AVG_SECONDS_PER_VIEW}`;
    const IS_MATCH = `COALESCE(c.team_1_name, '') <> '' AND COALESCE(c.team_2_name, '') <> ''`;

    const base = `
      WITH base AS MATERIALIZED (
        SELECT c.date::date                                        AS day,
               DATE_TRUNC('month', c.date)::date                    AS month,
               COALESCE(NULLIF(c.country, ''), '${CONTENT_NO_COUNTRY}') AS country,
               COALESCE(c.tournament_id, 0)                         AS tournament_id,
               COALESCE(c.team_1_name, '')                          AS t1,
               COALESCE(c.team_2_name, '')                          AS t2,
               COALESCE(c.views, 0)                                 AS views,
               COALESCE(c.views_users, 0)                           AS users,
               -- Negative view-seconds are dropped, not clamped per row: 435
               -- rows carry one and every last of them is a source artefact.
               GREATEST(COALESCE(c.views_seconds, 0), 0)            AS seconds,
               (${IS_MATCH})                                        AS is_match
        ${scoped} AND ${KEPT}
      )`;

    const [countRows, grainRows, teamRows, topRows, activeRows, countryRows] =
      await Promise.all([
        // The filter reports itself: one scan yields both what survived and what
        // each rule cost, so the tab can say 3,094 short rows rather than imply
        // the catalogue is 3,094 rows smaller than it is.
        this.conn.execute(sql.raw(`
          SELECT COUNT(*)::int                                          AS rows_in_range,
                 COUNT(*) FILTER (WHERE c.status <> 1)::int             AS dropped_status,
                 COUNT(*) FILTER (WHERE c.status = 1 AND NOT (${KEPT}))::int AS dropped_short,
                 COUNT(*) FILTER (WHERE ${KEPT})::int                   AS rows_kept,
                 COUNT(*) FILTER (WHERE ${KEPT} AND ${IS_MATCH})::int    AS matches_complete,
                 COALESCE(SUM(c.views)      FILTER (WHERE ${KEPT}), 0)::bigint AS views,
                 COALESCE(SUM(c.views_users) FILTER (WHERE ${KEPT}), 0)::bigint AS users,
                 COALESCE(SUM(GREATEST(c.views_seconds, 0)) FILTER (WHERE ${KEPT}), 0)::bigint AS seconds,
                 MIN(c.date) FILTER (WHERE ${KEPT})                     AS date_min,
                 MAX(c.date) FILTER (WHERE ${KEPT})                     AS date_max
          ${scoped}
        `)),
        // Three grains, one scan. grp is GROUPING(month, country, tournament_id):
        //   (month)         -> 011 = 3
        //   (country)       -> 101 = 5
        //   (tournament_id) -> 110 = 6
        // The tournament set carries both totals and match-only totals, because
        // "top leagues by audience" and "matches per league" are the same
        // grouping asked two ways — the second excludes programmes and
        // highlights, which have no two teams.
        this.conn.execute(sql.raw(`
          ${base}
          SELECT GROUPING(b.month, b.country, b.tournament_id)::int AS grp,
                 b.month, b.country, b.tournament_id,
                 COALESCE(tt.name, CASE WHEN b.tournament_id = 0 THEN 'Sin torneo'
                                        ELSE 'Torneo ' || b.tournament_id END) AS name,
                 COALESCE(tt.country, '')      AS country_master,
                 SUM(b.views)::bigint          AS views,
                 SUM(b.users)::bigint          AS users,
                 SUM(b.seconds)::bigint        AS seconds,
                 COUNT(*)::int                 AS cnt,
                 COUNT(*) FILTER (WHERE b.is_match)::int              AS matches,
                 COALESCE(SUM(b.views) FILTER (WHERE b.is_match), 0)::bigint AS match_views,
                 COALESCE(SUM(b.users) FILTER (WHERE b.is_match), 0)::bigint AS match_users
          FROM base b
          LEFT JOIN basket_tournaments tt ON tt.id = b.tournament_id
          GROUP BY GROUPING SETS ((b.month), (b.country), (b.tournament_id, tt.name, tt.country))
        `)),
        // A match counts for both its teams, so the two name columns are unioned
        // rather than joined — a team's row is every match it appeared in, home
        // or away, which is what the prototype's ranking measures.
        this.conn.execute(sql.raw(`
          ${base}
          SELECT team,
                 SUM(views)::bigint  AS views,
                 SUM(users)::bigint  AS users,
                 COUNT(*)::int       AS cnt
          FROM (
            SELECT t1 AS team, views, users FROM base WHERE t1 <> ''
            UNION ALL
            SELECT t2 AS team, views, users FROM base WHERE t2 <> ''
          ) x
          GROUP BY team
          ORDER BY views DESC
          LIMIT ${TOP_TEAMS}
        `)),
        this.conn.execute(sql.raw(`
          ${base}
          SELECT b.day, b.views, b.users, b.t1, b.t2, b.country,
                 COALESCE(tt.name, '') AS name
          FROM base b
          LEFT JOIN basket_tournaments tt ON tt.id = b.tournament_id
          ORDER BY b.views DESC
          LIMIT ${TOP_CONTENT}
        `)),
        // Active at the close of the month, so the last day the view holds for
        // that month — not the month's average, and not today's number carried
        // backwards.
        this.conn.execute(sql.raw(`
          SELECT month, all_active::int AS active
          FROM (
            SELECT DATE_TRUNC('month', day)::date AS month,
                   all_active,
                   ROW_NUMBER() OVER (PARTITION BY DATE_TRUNC('month', day)
                                      ORDER BY day DESC) AS rn
            FROM basket_mat_daily_active
            WHERE day >= '${f}'::date AND day < '${t}'::date + 1
          ) x
          WHERE rn = 1
          ORDER BY month
        `)),
        // The picker lists every country the catalogue has ever carried, not the
        // range's — otherwise narrowing the range removes the option that would
        // widen it again.
        this.conn.execute(sql.raw(`
          SELECT DISTINCT COALESCE(NULLIF(c.country, ''), '${CONTENT_NO_COUNTRY}') AS country
          FROM basket_content c
          WHERE ${KEPT}
          ORDER BY 1
        `)),
      ]);

    const c0 = ((countRows as unknown) as RowAny[])[0] ?? {};
    const grains = (grainRows as unknown) as RowAny[];
    const GRP_MONTH = 3;
    const GRP_COUNTRY = 5;
    const GRP_TOURNAMENT = 6;

    const tournamentRows = grains.filter((r) => n(r.grp) === GRP_TOURNAMENT);
    const topViews = ((topRows as unknown) as RowAny[]).map((r) => ({
      date: d(r.day),
      title: '',
      team1: s(r.t1),
      team2: s(r.t2),
      tournamentName: s(r.name),
      country: s(r.country),
      views: n(r.views),
      users: n(r.users),
    }));

    return {
      from: f,
      to: t,
      country,
      catalogue: {
        status: 1,
        minAvgSecondsPerView: MIN_AVG_SECONDS_PER_VIEW,
        rowsInRange: n(c0.rows_in_range),
        rowsKept: n(c0.rows_kept),
        rowsDroppedStatus: n(c0.dropped_status),
        rowsDroppedShort: n(c0.dropped_short),
      },
      totals: {
        contentCount: n(c0.rows_kept),
        matchesComplete: n(c0.matches_complete),
        views: n(c0.views),
        users: n(c0.users),
        seconds: n(c0.seconds),
        dateMin: d(c0.date_min),
        dateMax: d(c0.date_max),
      },
      monthly: grains
        .filter((r) => n(r.grp) === GRP_MONTH)
        .map((r) => ({
          month: d(r.month),
          views: n(r.views),
          users: n(r.users),
          seconds: n(r.seconds),
          count: n(r.cnt),
          matches: n(r.matches),
        }))
        .sort((a, b) => (a.month < b.month ? -1 : 1)),
      byCountry: grains
        .filter((r) => n(r.grp) === GRP_COUNTRY)
        .map((r) => ({
          country: s(r.country),
          views: n(r.views),
          users: n(r.users),
          count: n(r.cnt),
          matches: n(r.matches),
        }))
        .sort((a, b) => b.views - a.views),
      byTournament: tournamentRows
        .map((r) => ({
          tournamentId: n(r.tournament_id),
          name: s(r.name),
          countryMaster: s(r.country_master),
          views: n(r.views),
          users: n(r.users),
          count: n(r.cnt),
          matches: n(r.matches),
        }))
        .sort((a, b) => b.views - a.views),
      byLeague: tournamentRows
        .filter((r) => n(r.matches) > 0)
        .map((r) => ({
          tournamentId: n(r.tournament_id),
          name: s(r.name),
          countryMaster: s(r.country_master),
          views: n(r.match_views),
          users: n(r.match_users),
          count: n(r.matches),
          matches: n(r.matches),
        }))
        .sort((a, b) => b.matches - a.matches),
      byTeam: ((teamRows as unknown) as RowAny[]).map((r) => ({
        team: s(r.team),
        views: n(r.views),
        users: n(r.users),
        count: n(r.cnt),
      })),
      topViews,
      topEventDays: await this.contentEventDays(topViews.slice(0, TOP_EVENT_DAYS)),
      monthlyActive: ((activeRows as unknown) as RowAny[]).map((r) => ({
        month: d(r.month),
        active: n(r.active),
      })),
      countries: ((countryRows as unknown) as RowAny[]).map((r) => s(r.country)),
    };
  }

  // Altas on the days the biggest content landed. A Pago is an alta when it is
  // the Subscriber's first, or when their previous one had already lapsed —
  // the same two buckets basket_mat_monthly_lifecycle counts, asked per day.
  //
  // Restricted to the Subscribers who paid on one of those days before the
  // window function runs: the LAG needs a whole Subscriber's history, but it
  // does not need everybody's.
  private async contentEventDays(
    top: ContenidoTopRow[],
  ): Promise<ContenidoEventDayRow[]> {
    const days = [...new Set(top.map((r) => r.date).filter(Boolean))];
    if (days.length === 0) return [];
    const list = days.map((x) => `'${x}'::date`).join(', ');
    const rows = (await this.conn.execute(sql.raw(`
      WITH touched AS (
        SELECT DISTINCT user_id
        FROM basket_v_active_payments
        WHERE created_at::date IN (${list})
      ),
      hist AS (
        SELECT p.user_id, p.created_at,
               ROW_NUMBER() OVER (PARTITION BY p.user_id ORDER BY p.created_at) AS rn,
               LAG(p.expires_at) OVER (PARTITION BY p.user_id ORDER BY p.created_at) AS prev_expires
        FROM basket_v_active_payments p
        JOIN touched t ON t.user_id = p.user_id
      )
      SELECT created_at::date AS day,
             COUNT(*) FILTER (WHERE rn = 1)::int AS new_subs,
             COUNT(*) FILTER (WHERE rn > 1
                              AND prev_expires + INTERVAL '7 days' < created_at)::int AS reactivated
      FROM hist
      WHERE created_at::date IN (${list})
      GROUP BY 1
    `)) as unknown) as RowAny[];
    const byDay = new Map(rows.map((r) => [d(r.day), r]));
    return top.map((r) => ({
      ...r,
      newSubs: n(byDay.get(r.date)?.new_subs),
      reactivated: n(byDay.get(r.date)?.reactivated),
    }));
  }

  // --------------------------------------------------------------------------
  // GATEWAY NET — fees, net and refunds off basket_payment_fees, plus
  // subscription churn off basket_gateway_subscriptions (Stripe and MercadoPago).
  //
  // Everything money-shaped here is bucketed on captured_at (true UTC), the
  // clock basket_mat_gateway_net_daily picked; basket_payments.created_at is
  // Argentina local time stored as UTC and is never mixed in.
  // --------------------------------------------------------------------------
  async getGatewayNet(
    range: DateRange,
    filters?: CommonFilters,
  ): Promise<GatewayNetDTO> {
    const { from, to } = rangeBounds(range);
    const f = from.toISOString().slice(0, 10);
    const t = to.toISOString().slice(0, 10);
    const filtered = hasFilters(filters);

    const [moneyRows, statusRows, subMonthRows, coverageRows, fxRows] = await Promise.all([
      filtered
        ? this.gatewayMoneyFiltered(f, t, filters!)
        : this.gatewayMoneyUnfiltered(f, t),
      // Status is a current-state snapshot, so it is deliberately not windowed
      // by the range: "how many subscriptions are canceled today" has no
      // meaningful restriction to a past month. Churn reads status, never
      // canceled_at — 15,636 canceled rows carry no canceled_at.
      this.conn.execute(sql.raw(`
        SELECT platform, status,
               COUNT(*)::int           AS c,
               COUNT(canceled_at)::int AS with_canceled_at
        FROM basket_gateway_subscriptions
        WHERE platform IN ${SUBSCRIPTION_PLATFORMS}
        GROUP BY platform, status
        ORDER BY c DESC
      `)),
      // The monthly shape is the datable subset only: a cancellation without a
      // canceled_at cannot be placed on a timeline at all, and the status
      // counts above are what covers those rows.
      this.conn.execute(sql.raw(`
        WITH created AS (
          SELECT platform, DATE_TRUNC('month', created_at)::date AS m, COUNT(*)::int AS n
          FROM basket_gateway_subscriptions
          WHERE platform IN ${SUBSCRIPTION_PLATFORMS}
            AND created_at >= '${f}'::date AND created_at < '${t}'::date + 1
            -- A MercadoPago preapproval is created when checkout opens; only
            -- the ones that went on to bill are an alta. Stripe has no such
            -- state worth excluding (its 'incomplete' is rare and expires).
            AND status <> 'pending'
          GROUP BY 1, 2
        ),
        canceled AS (
          SELECT platform, DATE_TRUNC('month', canceled_at)::date AS m, COUNT(*)::int AS n
          FROM basket_gateway_subscriptions
          WHERE platform IN ${SUBSCRIPTION_PLATFORMS}
            AND canceled_at >= '${f}'::date AND canceled_at < '${t}'::date + 1
          GROUP BY 1, 2
        )
        SELECT COALESCE(c.platform, x.platform) AS platform,
               COALESCE(c.m, x.m)               AS month,
               COALESCE(c.n, 0)                 AS created,
               COALESCE(x.n, 0)                 AS canceled
        FROM created c
        FULL OUTER JOIN canceled x ON x.m = c.m AND x.platform = c.platform
        ORDER BY 2, 1
      `)),
      // All-time on purpose: coverage moves when Pagos are ingested, not only
      // when fees are, so a range-windowed figure reads as a coverage
      // regression when it is really just new Pagos.
      // Bucketed by id SHAPE as well as currency, because MercadoPago has two.
      // Its numeric ids are payments and can carry a fee; its 143,577 hex32 ids
      // are preapprovals — subscription objects that never had a fee to report.
      // One coverage number over both would sit near 73% forever and read as a
      // permanent data loss instead of as two populations, one of which is not
      // supposed to be here.
      this.conn.execute(sql.raw(`
        SELECT p.platform                        AS platform,
               p.currency                        AS currency,
               CASE WHEN p.platform_payment_id ~ '^[0-9a-f]{32}$'
                    THEN 'preapproval' ELSE 'payment' END AS id_shape,
               COUNT(*)::int                     AS successful,
               COUNT(f.platform_payment_id)::int AS with_fee
        FROM basket_payments p
        LEFT JOIN basket_payment_fees f
          ON f.platform = p.platform AND f.platform_payment_id = p.platform_payment_id
        WHERE p.platform IN (${GATEWAY_PLATFORM_LIST})
          AND p.status = 1
          AND p.platform_payment_id IS NOT NULL
        GROUP BY p.platform, p.currency, id_shape
        ORDER BY successful DESC
      `)),
      // The FX plane, day by day over the range. Only the fetched sources are
      // read here: the derived 'stripe' rows are provenance for a conversion
      // Stripe already did, and using them to convert a settlement figure that
      // is already USD would apply a rate twice. See docs/adr/0007.
      this.conn.execute(sql.raw(`
        SELECT day::text AS day, quote_currency, source, rate::float8 AS rate
        FROM basket_fx_rates
        WHERE base_currency = 'USD'
          -- Both fetched sources, and they cannot collide: 'blue' quotes ARS,
          -- 'oficial_cross' quotes EUR, and the index below is keyed by the
          -- quote currency. A second source for one pair would need a choice;
          -- two sources for two pairs need none.
          AND source IN ('blue', 'oficial_cross')
          AND day BETWEEN '${f}'::date AND '${t}'::date
      `)),
    ]);

    const money = (moneyRows as unknown) as RowAny[];
    const settlement = money.filter((r) => s(r.grain) === 'settlement');
    const refunds = money.filter((r) => s(r.grain) === 'refund');

    // The Providers actually present in this range, not the whole seam: a range
    // with no MercadoPago Pagos should not label itself as covering MercadoPago.
    const presentPlatforms = [...new Set(settlement.map((r) => n(r.platform)))].sort();
    const subscriptionPlatforms = [
      ...new Set(((statusRows as unknown) as RowAny[]).map((r) => n(r.platform))),
    ].sort();

    // USD is computed from the DAY grain and never from the month or the total:
    // the blue rate moves every day and ARS inflation makes a month-rate
    // conversion wrong by whole percent, not by rounding. The day rows are
    // already in hand for both the filtered and unfiltered paths, so the two
    // convert identically and neither needs its own SQL.
    const netByDay: NetDailyPoint[] = settlement
      .filter((r) => n(r.grp) === GRP_DAY)
      .map((r) => ({
        day: d(r.day),
        platform: n(r.platform),
        platformName: gatewayName(n(r.platform)),
        settlementCurrency: s(r.ccy),
        grossSettlement: n(r.gross),
        fees: n(r.fees),
        taxes: n(r.taxes),
        net: n(r.net),
        txCount: n(r.tx_count),
      }))
      .sort((a, b) => (a.day < b.day ? -1 : a.day > b.day ? 1 : a.settlementCurrency < b.settlementCurrency ? -1 : 1));

    const rates = indexRates(((fxRows as unknown) as RowAny[]).map((r): DailyRate => ({
      day: d(r.day),
      quoteCurrency: s(r.quote_currency),
      source: s(r.source),
      rate: n(r.rate),
    })));

    return {
      platformName: presentPlatforms.map(gatewayName).join(' · ') || GATEWAY_PLATFORM_NAMES[4],
      platformNames: presentPlatforms.map(gatewayName),
      subscriptionPlatformName: subscriptionPlatforms.map(gatewayName).join(' · ') || GATEWAY_PLATFORM_NAMES[4],
      settlementTotals: settlement
        .filter((r) => n(r.grp) === GRP_TOTAL)
        .map((r) => ({
          platform: n(r.platform),
          platformName: gatewayName(n(r.platform)),
          settlementCurrency: s(r.ccy),
          grossSettlement: n(r.gross),
          fees: n(r.fees),
          taxes: n(r.taxes),
          net: n(r.net),
          txCount: n(r.tx_count),
          feePct: feePct(n(r.fees), n(r.gross)),
          taxPct: feePct(n(r.taxes), n(r.gross)),
        }))
        .sort((a, b) => b.grossSettlement - a.grossSettlement),
      netByDay,
      netByMonth: settlement
        .filter((r) => n(r.grp) === GRP_MONTH)
        .map((r) => ({
          month: d(r.month),
          platform: n(r.platform),
          platformName: gatewayName(n(r.platform)),
          settlementCurrency: s(r.ccy),
          grossSettlement: n(r.gross),
          fees: n(r.fees),
          taxes: n(r.taxes),
          net: n(r.net),
          txCount: n(r.tx_count),
        }))
        .sort((a, b) => (a.month < b.month ? -1 : a.month > b.month ? 1 : a.settlementCurrency < b.settlementCurrency ? -1 : 1)),
      refundsByCurrency: refunds
        .filter((r) => n(r.grp) === GRP_TOTAL)
        .map((r) => ({
          platform: n(r.platform),
          platformName: gatewayName(n(r.platform)),
          currency: s(r.ccy),
          refundedAmount: n(r.refunded),
          refundCount: n(r.refund_count),
        }))
        .sort((a, b) => b.refundCount - a.refundCount),
      subscriptionsByStatus: ((statusRows as unknown) as RowAny[]).map((r) => ({
        platform: n(r.platform),
        platformName: gatewayName(n(r.platform)),
        status: s(r.status),
        lifecycle: subscriptionLifecycle(s(r.status)),
        count: n(r.c),
        withCanceledAt: n(r.with_canceled_at),
      })),
      subscriptionsByMonth: ((subMonthRows as unknown) as RowAny[]).map((r) => ({
        month: d(r.month),
        platform: n(r.platform),
        platformName: gatewayName(n(r.platform)),
        created: n(r.created),
        canceled: n(r.canceled),
      })),
      coverage: ((coverageRows as unknown) as RowAny[]).map((r) => ({
        platform: n(r.platform),
        platformName: gatewayName(n(r.platform)),
        currency: s(r.currency),
        idShape: s(r.id_shape) === 'preapproval' ? ('preapproval' as const) : ('payment' as const),
        successful: n(r.successful),
        withFee: n(r.with_fee),
        coveragePct: n(r.successful) === 0
          ? 0
          : Math.round((n(r.with_fee) / n(r.successful)) * 1000) / 10,
      })),
      usdTotals: usdTotals(netByDay, rates),
      netUsdByMonth: usdByMonth(netByDay, rates),
      subscriptionsIgnoreFilters: filtered,
      netExcludesUnmatchedFees: filtered,
    };
  }

  // One scan of the pre-aggregated view, split by GROUPING SETS into the day,
  // month and total grains. `grain` is already a column of the view — the two
  // currency planes never share a row, so grouping by it keeps them apart.
  private gatewayMoneyUnfiltered(f: string, t: string): Promise<unknown> {
    return this.conn.execute(sql.raw(`
      WITH base AS (
        SELECT grain, day, DATE_TRUNC('month', day)::date AS month, platform, ccy,
               gross, fees, taxes, net, tx_count, refunded, refund_count
        FROM basket_mat_gateway_net_daily
        WHERE day BETWEEN '${f}'::date AND '${t}'::date
      )
      SELECT GROUPING(day, month)::int AS grp,
             grain, day, month, platform, ccy,
             SUM(gross)::numeric        AS gross,
             SUM(fees)::numeric         AS fees,
             SUM(taxes)::numeric        AS taxes,
             SUM(net)::numeric          AS net,
             SUM(tx_count)::int         AS tx_count,
             SUM(refunded)::numeric     AS refunded,
             SUM(refund_count)::int     AS refund_count
      FROM base
      -- Platform is part of every grouping set, never summed away. Two
      -- Providers can settle the same currency (they do not today, and the
      -- moment one does, a total that had grouped them together would silently
      -- merge two fee structures into one ratio).
      GROUP BY GROUPING SETS (
        (grain, platform, ccy, day),
        (grain, platform, ccy, month),
        (grain, platform, ccy)
      )
    `));
  }

  // Filtered path. basket_payment_fees carries no user dimension, so the filter
  // is applied to the payments and the mirror is joined by the gateway id — the
  // same (platform, platform_payment_id) pair the mirror is keyed on. The range
  // is applied to captured_at, matching the view's clock, so the two paths
  // bucket identically.
  //
  // They do NOT cover the same population, and cannot: joining to payments
  // drops the 8,675 fee rows (4.7%) whose Pago was never ingested or whose
  // Subscriber is unknown. Reported as netExcludesUnmatchedFees rather than
  // papered over by making the unfiltered path join too — the headline total
  // should be the whole mirror.
  private gatewayMoneyFiltered(f: string, t: string, filters: CommonFilters): Promise<unknown> {
    const fw = buildActiveFilterWhere(filters);
    return this.conn.execute(sql.raw(`
      WITH pay AS MATERIALIZED (
        SELECT platform, platform_payment_id
        FROM basket_v_active_payments
        WHERE platform IN (${GATEWAY_PLATFORM_LIST})
          AND platform_payment_id IS NOT NULL
          ${fw}
      ),
      base AS MATERIALIZED (
        SELECT f.captured_at::date                        AS day,
               DATE_TRUNC('month', f.captured_at)::date   AS month,
               f.platform                                 AS platform,
               f.settlement_currency                      AS s_ccy,
               f.currency                                 AS p_ccy,
               f.settlement_amount, f.fee_amount,
               COALESCE(f.tax_amount, 0)                  AS tax_amount,
               f.net_amount, f.refunded_amount
        FROM basket_payment_fees f
        JOIN pay ON pay.platform = f.platform
                AND pay.platform_payment_id = f.platform_payment_id
        WHERE f.platform IN (${GATEWAY_PLATFORM_LIST})
          AND f.captured_at >= '${f}'::date
          AND f.captured_at <  '${t}'::date + 1
      )
      SELECT 'settlement'::text          AS grain,
             GROUPING(day, month)::int   AS grp,
             day, month, platform, s_ccy AS ccy,
             SUM(settlement_amount)::numeric AS gross,
             SUM(fee_amount)::numeric       AS fees,
             SUM(tax_amount)::numeric       AS taxes,
             SUM(net_amount)::numeric       AS net,
             COUNT(*)::int                  AS tx_count,
             0::numeric                     AS refunded,
             0::int                         AS refund_count
      FROM base
      GROUP BY GROUPING SETS (
        (platform, s_ccy, day),
        (platform, s_ccy, month),
        (platform, s_ccy)
      )
      UNION ALL
      -- Presentment plane, totals only: a refund series per day carries no
      -- signal the totals do not, and mixing planes in one series would invite
      -- exactly the cross-plane sum this shape exists to prevent.
      SELECT 'refund'::text, ${GRP_TOTAL}, NULL::date, NULL::date, platform, p_ccy,
             0::numeric, 0::numeric, 0::numeric, 0::numeric, 0::int,
             SUM(refunded_amount)::numeric, COUNT(*)::int
      FROM base
      WHERE refunded_amount <> 0
      GROUP BY platform, p_ccy
    `));
  }

  // --------------------------------------------------------------------------
  // RETENTION — mat_monthly_lifecycle scan (small table), windowed by range.
  // Filters can't be answered by the pre-aggregated view, so they fall through
  // to live SQL that recomputes the same lifecycle over the filtered payments.
  // --------------------------------------------------------------------------
  async getRetention(range?: DateRange, filters?: CommonFilters): Promise<RetentionDTO> {
    if (hasFilters(filters)) return this.getRetentionFiltered(range, filters!);

    const rows = await this.conn.execute(sql.raw(`
      SELECT month, active_start, active_end, new_payers, renewals,
             reactivations, expirations, churn_rate_pct, retention_rate_pct
      FROM basket_mat_monthly_lifecycle
      ${monthWindowWhere(range)}
      ORDER BY month
    `));
    return toRetentionDTO(rows);
  }

  // --------------------------------------------------------------------------
  // RETENTION (filtered) — live SQL mirroring basket_mat_monthly_lifecycle.
  // Every CTE reads the same filtered `payments`, so a user outside the filter
  // never counts as active, as a renewal, or as an expiration.
  // --------------------------------------------------------------------------
  private async getRetentionFiltered(
    range: DateRange | undefined,
    filters: CommonFilters,
  ): Promise<RetentionDTO> {
    const fw = buildActiveFilterWhere(filters);
    const rows = await this.conn.execute(sql.raw(`
      -- MATERIALIZED: four CTEs read payments, and basket_v_active_payments
      -- is a 3-way join over ~400k rows — without it Postgres re-runs that join
      -- once per reference.
      WITH payments AS MATERIALIZED (
        SELECT user_id, created_at, expires_at
        FROM basket_v_active_payments
        WHERE 1=1 ${fw}
      ),
      per_user_payment AS (
        SELECT
          user_id,
          created_at,
          expires_at,
          DATE_TRUNC('month', created_at)::date                      AS created_month,
          DATE_TRUNC('month', expires_at + INTERVAL '7 days')::date  AS expire_month,
          LAG(expires_at) OVER (PARTITION BY user_id ORDER BY created_at) AS prev_expires,
          -- Earliest start among this user's payments that outlast the current
          -- one. A self-join here is O(n^2) over the filtered set; the window
          -- answers the same question in one sorted pass.
          MIN(created_at) OVER (
            PARTITION BY user_id ORDER BY expires_at
            GROUPS BETWEEN 1 FOLLOWING AND UNBOUNDED FOLLOWING
          ) AS next_cover_created
        FROM payments
      ),
      first_payment AS (
        SELECT user_id, DATE_TRUNC('month', MIN(created_at))::date AS first_month
        FROM payments GROUP BY user_id
      ),
      months AS (
        SELECT generate_series(${monthSeriesBounds(range)}, INTERVAL '1 month')::date AS m
      ),
      new_payers AS (
        SELECT first_month AS m, COUNT(*) AS c FROM first_payment GROUP BY first_month
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
      -- A user expires in the month their access lapses with nothing taking over.
      expirations AS (
        SELECT expire_month AS m, COUNT(DISTINCT user_id) AS c
        FROM per_user_payment
        WHERE next_cover_created IS NULL
           OR next_cover_created > expires_at + INTERVAL '7 days'
        GROUP BY expire_month
      ),
      -- Islands -> ±1 events -> running sum, as in getEvolutionFiltered: the
      -- old months × payments cross join re-scanned every payment per month;
      -- here coverage is merged once and each month reads the standing total.
      spans AS (
        SELECT user_id,
               created_at::date                       AS s,
               (expires_at + INTERVAL '7 days')::date AS e
        FROM payments
        -- See getTeams: a Pago expiring before it was created is active on no day.
        WHERE (expires_at + INTERVAL '7 days')::date >= created_at::date
      ),
      marked AS (
        SELECT user_id, s, e,
               MAX(e) OVER (
                 PARTITION BY user_id ORDER BY s
                 ROWS BETWEEN UNBOUNDED PRECEDING AND 1 PRECEDING
               ) AS prev_max_e
        FROM spans
      ),
      grouped AS (
        SELECT user_id, s, e,
               SUM(CASE WHEN prev_max_e IS NULL OR s > prev_max_e + 1 THEN 1 ELSE 0 END)
                 OVER (PARTITION BY user_id ORDER BY s ROWS UNBOUNDED PRECEDING) AS island
        FROM marked
      ),
      islands AS (
        SELECT MIN(s) AS s, MAX(e) AS e
        FROM grouped GROUP BY user_id, island
      ),
      events AS (
        SELECT s AS d,  1 AS delta FROM islands
        UNION ALL
        SELECT e + 1   , -1        FROM islands
      ),
      timeline AS (
        SELECT d, SUM(SUM(delta)) OVER (ORDER BY d) AS active
        FROM events GROUP BY d
      ),
      -- A user has at most one island covering any day, so the running sum is
      -- exactly the COUNT(DISTINCT user_id) the cross join used to compute.
      active_at_month AS (
        SELECT
          m.m,
          COALESCE(ts.active, 0) AS active_start,
          COALESCE(te.active, 0) AS active_end
        FROM months m
        -- The standing total at the month's first and last day.
        LEFT JOIN LATERAL (
          SELECT active FROM timeline WHERE d <= m.m ORDER BY d DESC LIMIT 1
        ) ts ON TRUE
        LEFT JOIN LATERAL (
          SELECT active FROM timeline
          WHERE d <= (m.m + INTERVAL '1 month' - INTERVAL '1 day')::date
          ORDER BY d DESC LIMIT 1
        ) te ON TRUE
      )
      SELECT
        a.m AS month,
        a.active_start,
        a.active_end,
        COALESCE(n.c, 0) AS new_payers,
        COALESCE(r.c, 0) AS renewals,
        COALESCE(x.c, 0) AS reactivations,
        COALESCE(e.c, 0) AS expirations,
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
      LEFT JOIN expirations   e ON e.m = a.m
      ORDER BY a.m
    `));
    return toRetentionDTO(rows);
  }

  // --------------------------------------------------------------------------
  // LIFECYCLE — user-base funnel + daily subscription movement.
  // Live SQL only, no mat view: the filters redefine island boundaries (drop a
  // sub_type and a user's uninterrupted access splits in two), so nothing can
  // be pre-aggregated by day and sliced afterwards. Same reason
  // basket_mat_team_daily only carries team_id.
  // --------------------------------------------------------------------------
  async getLifecycle(range: DateRange, filters?: CommonFilters): Promise<LifecycleDTO> {
    const { from, to } = rangeBounds(range);
    const f = d(from);
    const t = d(to);

    const [funnelRows, seriesRows] = await Promise.all([
      this.lifecycleFunnel(t, filters),
      this.lifecycleSeries(f, t, filters),
    ]);

    const fr = ((funnelRows as unknown) as RowAny[])[0] ?? {};
    return {
      range,
      from: f,
      to: t,
      accessFilterIgnoredOnUsers: Boolean(filters?.accessType || filters?.subType),
      funnel: {
        totalUsers: n(fr.total_users),
        verifiedUsers: n(fr.verified_users),
        everSubscribed: n(fr.ever_subscribed),
        activeNoSub: n(fr.active_no_sub),
        neverSubscribed: n(fr.never_subscribed),
      },
      series: ((seriesRows as unknown) as RowAny[]).map((r) => ({
        day: d(r.day),
        nuevos: n(r.nuevos),
        reactivaciones: n(r.reactivaciones),
        renovaciones: n(r.renovaciones),
        activeSubs: n(r.active_subs),
      })),
    };
  }

  // Payment source for the lifecycle queries. Unfiltered it reads the table
  // directly: basket_v_active_payments is a 3-way join over ~435k rows and the
  // window pass below has to sort all of them, so skipping the join is worth
  // ~2s. Filters only exist on the view, so a filtered call pays for it.
  private lifecycleSource(filters?: CommonFilters): string {
    if (!hasFilters(filters)) {
      return `SELECT user_id, created_at, expires_at FROM basket_payments WHERE status = 1`;
    }
    return `SELECT user_id, created_at, expires_at
            FROM basket_v_active_payments WHERE 1=1 ${buildActiveFilterWhere(filters)}`;
  }

  // accessType/subType live on payments, so they cannot narrow a user who never
  // paid. The user-side counts honour `countries` only — the DTO flags this so
  // the UI can say the number is not filtered by access.
  private countryWhere(filters?: CommonFilters): string {
    if (!filters?.countries || filters.countries.length === 0) return '';
    const list = filters.countries.map((c) => `'${escStr(c)}'`).join(',');
    return ` AND u.country IN (${list})`;
  }

  private async lifecycleFunnel(t: string, filters?: CommonFilters): Promise<unknown> {
    const cw = this.countryWhere(filters);
    const src = this.lifecycleSource(filters);
    // `login_at` is a single overwritten timestamp, so the two activity counts
    // are as of NOW() whatever the range says. Coverage uses the same 7-day
    // grace as every other basket query, so they tie out with Activos totales.
    return this.conn.execute(sql.raw(`
      WITH src AS MATERIALIZED (${src})
      SELECT
        (SELECT COUNT(*)::int FROM basket_users u
          WHERE u.status = 1 AND u.created_at < '${t}'::date + 1 ${cw}) AS total_users,
        (SELECT COUNT(*)::int FROM basket_users u
          WHERE u.status = 1 AND u.email_verified
            AND u.created_at < '${t}'::date + 1 ${cw}) AS verified_users,
        (SELECT COUNT(DISTINCT v.user_id)::int FROM src v
          WHERE v.created_at < '${t}'::date + 1) AS ever_subscribed,
        (SELECT COUNT(*)::int FROM basket_users u
          WHERE u.status = 1 AND u.login_at > NOW() - INTERVAL '30 days' ${cw}
            AND NOT EXISTS (
              SELECT 1 FROM basket_payments p
              WHERE p.user_id = u.id AND p.status = 1
                AND p.created_at <= NOW()
                AND p.expires_at + INTERVAL '7 days' >= NOW())) AS active_no_sub,
        (SELECT COUNT(*)::int FROM basket_users u
          WHERE u.status = 1 AND u.login_at > NOW() - INTERVAL '30 days' ${cw}
            AND NOT EXISTS (
              SELECT 1 FROM basket_payments p
              WHERE p.user_id = u.id AND p.status = 1)) AS never_subscribed
    `));
  }

  // One window pass over every payment feeds both halves:
  //   flows  — each payment classified nuevo (first ever) / reactivación
  //            (created more than 37 days after the previous expiry, the
  //            basket_mat_monthly_lifecycle rule) / renovación (the rest),
  //            then collapsed to one row per user per day by that precedence.
  //   stock  — payment spans merged into islands of uninterrupted access
  //            (7-day grace, as everywhere else); ±1 at each island edge,
  //            running-summed from a seed of everything before the window.
  private async lifecycleSeries(
    f: string,
    t: string,
    filters?: CommonFilters,
  ): Promise<unknown> {
    // Repeated verbatim in the DISTINCT ON key: Postgres requires the leading
    // ORDER BY expressions to match the DISTINCT ON ones exactly.
    const KIND = `CASE WHEN rn = 1 THEN 1
                       WHEN created_at > prev_expires + INTERVAL '37 days' THEN 2
                       ELSE 3 END`;
    const rows = await this.conn.execute(sql.raw(`
      WITH w AS MATERIALIZED (
        SELECT user_id,
               created_at,
               created_at::date AS d,
               expires_at,
               ROW_NUMBER() OVER pu AS rn,
               LAG(expires_at) OVER pu AS prev_expires,
               MAX((expires_at + INTERVAL '7 days')::date) OVER (
                 PARTITION BY user_id ORDER BY created_at
                 ROWS BETWEEN UNBOUNDED PRECEDING AND 1 PRECEDING) AS prev_max
        FROM (${this.lifecycleSource(filters)}) p
        WINDOW pu AS (PARTITION BY user_id ORDER BY created_at)
      ),
      dedup AS (
        SELECT DISTINCT ON (user_id, d) user_id, d, ${KIND} AS k
        FROM w
        ORDER BY user_id, d, ${KIND}
      ),
      flows AS (
        SELECT d,
               COUNT(*) FILTER (WHERE k = 1)::int AS nuevos,
               COUNT(*) FILTER (WHERE k = 2)::int AS reactivaciones,
               COUNT(*) FILTER (WHERE k = 3)::int AS renovaciones
        FROM dedup GROUP BY d
      ),
      grp AS (
        SELECT user_id,
               created_at::date AS s,
               (expires_at + INTERVAL '7 days')::date AS e,
               SUM(CASE WHEN prev_max IS NULL OR created_at::date > prev_max + 1
                        THEN 1 ELSE 0 END) OVER (PARTITION BY user_id ORDER BY created_at) AS island
        FROM w
        -- See getTeams: a Pago expiring before it was created is active on no
        -- day, and would otherwise put its baja decades before its alta.
        WHERE (expires_at + INTERVAL '7 days')::date >= created_at::date
      ),
      islands AS (
        SELECT MIN(s) AS s, MAX(e) AS e FROM grp GROUP BY user_id, island
      ),
      ev AS (
        SELECT s AS d, 1 AS delta FROM islands
        UNION ALL
        SELECT e + 1, -1 FROM islands
      ),
      agg AS (SELECT d, SUM(delta)::int AS delta FROM ev GROUP BY d),
      days AS (
        SELECT generate_series('${f}'::date, '${t}'::date, INTERVAL '1 day')::date AS d
      ),
      seed AS (
        SELECT COALESCE(SUM(delta), 0)::int AS base FROM agg WHERE d < '${f}'::date
      )
      SELECT days.d                            AS day,
             COALESCE(fl.nuevos, 0)            AS nuevos,
             COALESCE(fl.reactivaciones, 0)    AS reactivaciones,
             COALESCE(fl.renovaciones, 0)      AS renovaciones,
             (seed.base
              + SUM(COALESCE(a.delta, 0)) OVER (ORDER BY days.d))::int AS active_subs
      FROM days
      CROSS JOIN seed
      LEFT JOIN flows fl ON fl.d = days.d
      LEFT JOIN agg a ON a.d = days.d
      ORDER BY days.d
    `));
    return rows;
  }

  // --------------------------------------------------------------------------
  // DATA QUALITY — small set of count(*) probes in parallel
  // --------------------------------------------------------------------------
  async getDataQuality(): Promise<DataQualityDTO> {
    const [
      usersC, paymentsC, teamsC,
      noCountry, noTeam, orphanPayments, zeroAmountNonAntel, statusZero,
    ] = await Promise.all([
      this.conn.execute(sql.raw(`SELECT COUNT(*)::int AS c FROM basket_users`)),
      this.conn.execute(sql.raw(`SELECT COUNT(*)::int AS c FROM basket_payments`)),
      this.conn.execute(sql.raw(`SELECT COUNT(*)::int AS c FROM basket_teams`)),
      this.conn.execute(sql.raw(`SELECT COUNT(*)::int AS c FROM basket_users WHERE country IS NULL`)),
      this.conn.execute(sql.raw(`SELECT COUNT(*)::int AS c FROM basket_users WHERE promo_team_id IS NULL`)),
      this.conn.execute(sql.raw(`
        SELECT COUNT(*)::int AS c FROM basket_payments p
        LEFT JOIN basket_users u ON u.id = p.user_id
        WHERE u.id IS NULL`)),
      this.conn.execute(sql.raw(`
        SELECT COUNT(*)::int AS c FROM basket_payments
        WHERE amount = 0 AND platform <> 9 AND recurrent <> 0`)),
      this.conn.execute(sql.raw(`SELECT COUNT(*)::int AS c FROM basket_payments WHERE status = 0`)),
    ]);

    const v = (r: unknown): number => n(((r as unknown) as RowAny[])[0]?.c);
    return {
      generatedAt: new Date().toISOString(),
      syncLog: await this.getSyncLog(),
      totals: { users: v(usersC), payments: v(paymentsC), teams: v(teamsC) },
      issues: [
        { code: 'user_no_country',      description: 'Usuarios sin país informado',                      count: v(noCountry) },
        { code: 'user_no_team',         description: 'Usuarios sin equipo promocional asignado',                     count: v(noTeam) },
        { code: 'payment_orphan',       description: 'Pagos cuyo usuario no existe en la tabla de usuarios', count: v(orphanPayments) },
        { code: 'paid_zero_non_antel',  description: 'Plan pago (no Antel) con importe 0',          count: v(zeroAmountNonAntel) },
        { code: 'payment_failed',       description: 'Pagos con estado fallido',             count: v(statusZero) },
      ],
    };
  }

  /**
   * Manual Uploads and inbox ingests (basket_payment_uploads) merged with cron
   * and token runs (basket_sync_runs), newest first. Tolerates the runs table
   * not existing yet so the tab keeps working across the migration.
   */
  private async getSyncLog(limit = 60): Promise<SyncLogEntry[]> {
    const uploads = `
      SELECT created_at AS at,
             CASE WHEN uploaded_by LIKE 'cron:%' THEN 'inbox'
                  WHEN uploaded_by LIKE '%@%' THEN 'manual'
                  ELSE 'token' END AS kind,
             uploaded_by AS actor,
             filename
               || CASE WHEN window_from IS NOT NULL
                       THEN ' · ' || to_char(window_from, 'DD/MM/YY') || ' → ' || to_char(COALESCE(window_to, window_from), 'DD/MM/YY')
                       ELSE '' END AS detail,
             rows_ingested AS rows,
             NULL::int AS duration_ms,
             error
      FROM basket_payment_uploads`;
    const runs = `
      SELECT started_at AS at,
             trigger AS kind,
             actor,
             CASE WHEN error IS NOT NULL THEN CASE WHEN scope = 'upload' THEN 'Pagos' ELSE 'sincronización completa' END
                  WHEN scope = 'upload' THEN 'Pagos'
                  ELSE 'usuarios ' || COALESCE(users_synced, 0)
                    || ' · contenido ' || COALESCE(content_synced, 0)
                    || ' · sheets ' || COALESCE(sheets_synced, 0) END AS detail,
             payments_ingested AS rows,
             duration_ms,
             error
      FROM basket_sync_runs`;
    // sql.raw hands timestamptz back as text, so the ISO shape is made in SQL.
    const select = `SELECT to_char(at AT TIME ZONE 'UTC', 'YYYY-MM-DD"T"HH24:MI:SS"Z"') AS at,
             kind, actor, detail, rows, duration_ms, error`;
    const toEntry = (r: RowAny): SyncLogEntry => ({
      at: s(r.at),
      kind: s(r.kind) as SyncLogEntry['kind'],
      actor: s(r.actor),
      detail: s(r.detail),
      rows: r.rows == null ? null : Number(r.rows),
      durationMs: r.duration_ms == null ? null : Number(r.duration_ms),
      error: r.error == null ? null : String(r.error),
    });
    try {
      const rows = await this.conn.execute(sql.raw(
        `${select} FROM (${uploads} UNION ALL ${runs}) x ORDER BY at DESC LIMIT ${limit}`,
      ));
      return (rows as unknown as RowAny[]).map(toEntry);
    } catch (err) {
      if ((err as { code?: string }).code !== '42P01') throw err;
      const rows = await this.conn.execute(sql.raw(`${select} FROM (${uploads}) x ORDER BY at DESC LIMIT ${limit}`));
      return (rows as unknown as RowAny[]).map(toEntry);
    }
  }

  async getMeta(): Promise<MetaDTO> {
    const [rangeRows, countryRows] = await Promise.all([
      this.conn.execute(sql.raw(`
        SELECT MIN(day)::text AS min_day, MAX(day)::text AS max_day
        FROM basket_mat_daily_active
      `)),
      this.conn.execute(sql.raw(`
        SELECT country, COUNT(*)::int AS c
        FROM basket_users
        WHERE country IS NOT NULL AND country <> ''
        GROUP BY country
        ORDER BY c DESC
      `)),
    ]);

    const rangeRow = (rangeRows as unknown as RowAny[])[0] ?? {};
    const countries = (countryRows as unknown as RowAny[]).map((r) => s(r.country));

    return {
      dataRange: { minDay: s(rangeRow.min_day), maxDay: s(rangeRow.max_day) },
      countries,
      enums: META_ENUMS,
    };
  }
}
