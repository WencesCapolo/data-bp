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
import type { TeamsDTO, TeamTrendDTO } from '@basket/core/dtos/TeamsDTO';
import type { FinanceDTO } from '@basket/core/dtos/FinanceDTO';
import type { RetentionDTO } from '@basket/core/dtos/RetentionDTO';
import type { DataQualityDTO } from '@basket/core/dtos/DataQualityDTO';
import { META_ENUMS, type MetaDTO } from '@basket/core/dtos/MetaDTO';

type RowAny = Record<string, unknown>;
const n = (v: unknown): number => (v == null ? 0 : Number(v));
const s = (v: unknown): string => (v == null ? '' : String(v));
const d = (v: unknown): string => {
  if (v == null) return '';
  if (v instanceof Date) return v.toISOString().slice(0, 10);
  return String(v).slice(0, 10);
};

function rangeBounds(r: DateRange): { from: Date; to: Date } {
  const to = new Date();
  to.setUTCHours(23, 59, 59, 999);
  if (r.kind === 'custom') {
    return { from: new Date(r.from), to: new Date(r.to) };
  }
  const from = new Date(to);
  if (r.kind === '30d') from.setUTCDate(from.getUTCDate() - 30);
  else if (r.kind === '90d') from.setUTCDate(from.getUTCDate() - 90);
  else if (r.kind === 'ytd') from.setUTCMonth(0, 1);
  else from.setUTCFullYear(2020, 0, 1);
  from.setUTCHours(0, 0, 0, 0);
  return { from, to };
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

export class DrizzleAnalyticsQueryRepository implements IAnalyticsQueryRepository {
  constructor(private readonly conn: Db = db) {}

  // --------------------------------------------------------------------------
  // OVERVIEW — 1 mat view scan + 2 small queries, parallelized
  // --------------------------------------------------------------------------
  async getOverview(
    asOf: Date = new Date(),
    filters?: CommonFilters,
  ): Promise<OverviewDTO> {
    const day = asOf.toISOString().slice(0, 10);
    if (hasFilters(filters)) {
      return this.getOverviewFiltered(day, filters!);
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
        WHERE day BETWEEN ('${day}'::date - INTERVAL '29 days')::date AND '${day}'::date
        ORDER BY day
      `)),
      this.conn.execute(sql.raw(`
        SELECT COUNT(*)::int AS c
        FROM (
          SELECT user_id, MIN(created_at) AS first_at
          FROM basket_v_active_payments
          GROUP BY user_id
        ) f
        WHERE f.first_at >= ('${day}'::date - INTERVAL '30 days')
      `)),
      this.conn.execute(sql.raw(`
        SELECT currency, SUM(total_amount)::numeric AS amount
        FROM basket_mat_revenue_daily
        WHERE day >= ('${day}'::date - INTERVAL '30 days')
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

    const trend30d: OverviewTrendPoint[] = ((trendRows as unknown) as RowAny[]).map((r) => ({
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
        newPayersLast30d: n(((newPayersRows as unknown) as RowAny[])[0]?.c),
        revenueLast30dByCurrency: ((revRows as unknown) as RowAny[]).map((r) => ({
          currency: s(r.currency),
          amount: n(r.amount),
        })),
      },
      trend30d,
      accessBreakdown,
      subTypeBreakdown,
      countryBreakdown,
    };
  }

  // --------------------------------------------------------------------------
  // OVERVIEW (filtered) — live SQL on basket_v_active_payments
  // --------------------------------------------------------------------------
  private async getOverviewFiltered(day: string, filters: CommonFilters): Promise<OverviewDTO> {
    const fw = buildActiveFilterWhere(filters);

    const [todayRows, trendRows, newPayersRows, revRows] = await Promise.all([
      this.conn.execute(sql.raw(`
        WITH active AS (
          SELECT DISTINCT user_id, user_country, access_type, sub_type
          FROM basket_v_active_payments
          WHERE created_at::date <= '${day}'::date
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
      this.conn.execute(sql.raw(`
        WITH days AS (
          SELECT generate_series(('${day}'::date - INTERVAL '29 days')::date,
                                 '${day}'::date,
                                 '1 day'::interval)::date AS d
        ),
        f AS (
          SELECT user_id, created_at, expires_at, access_type
          FROM basket_v_active_payments
          WHERE 1=1 ${fw}
        )
        SELECT
          d.d AS day,
          COUNT(DISTINCT user_id) FILTER (
            WHERE created_at::date <= d.d
              AND (expires_at + INTERVAL '7 days')::date >= d.d
          )::int AS all_active,
          COUNT(DISTINCT user_id) FILTER (
            WHERE access_type='real'
              AND created_at::date <= d.d
              AND (expires_at + INTERVAL '7 days')::date >= d.d
          )::int AS real_active,
          COUNT(DISTINCT user_id) FILTER (
            WHERE access_type='voucher'
              AND created_at::date <= d.d
              AND (expires_at + INTERVAL '7 days')::date >= d.d
          )::int AS voucher_active
        FROM days d LEFT JOIN f ON TRUE
        GROUP BY d.d
        ORDER BY d.d
      `)),
      this.conn.execute(sql.raw(`
        SELECT COUNT(*)::int AS c FROM (
          SELECT user_id, MIN(created_at) AS first_at
          FROM basket_v_active_payments
          WHERE 1=1 ${fw}
          GROUP BY user_id
        ) f
        WHERE f.first_at >= ('${day}'::date - INTERVAL '30 days')
      `)),
      this.conn.execute(sql.raw(`
        SELECT currency, SUM(amount)::numeric AS amount
        FROM basket_v_active_payments
        WHERE created_at >= ('${day}'::date - INTERVAL '30 days')
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
    const trend30d: OverviewTrendPoint[] = ((trendRows as unknown) as RowAny[]).map((r) => ({
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
        newPayersLast30d: n(((newPayersRows as unknown) as RowAny[])[0]?.c),
        revenueLast30dByCurrency: ((revRows as unknown) as RowAny[]).map((r) => ({
          currency: s(r.currency),
          amount: n(r.amount),
        })),
      },
      trend30d,
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
    _filters?: CommonFilters,
  ): Promise<EvolutionDTO> {
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
  // TEAMS — group team_monthly by team within range
  // --------------------------------------------------------------------------
  async getTeams(
    range: DateRange,
    opts: { limit?: number; country?: string; filters?: CommonFilters } = {},
  ): Promise<TeamsDTO> {
    const { limit = 50, country } = opts;
    void opts.filters;
    const { from, to } = rangeBounds(range);
    const countryFilter = country
      ? `AND team_country = '${escStr(country)}'`
      : '';

    const [rankedRows, totalsRows] = await Promise.all([
      this.conn.execute(sql.raw(`
        SELECT team_id, team_name, league, team_country,
               SUM(unique_payers)::int   AS unique_payers,
               SUM(total_payments)::int  AS total_payments,
               SUM(total_amount)::numeric AS total_amount,
               SUM(real_payers)::int     AS real_payers,
               SUM(voucher_payers)::int  AS voucher_payers
        FROM basket_mat_team_monthly
        WHERE month BETWEEN '${from.toISOString().slice(0,10)}'::date
                        AND '${to.toISOString().slice(0,10)}'::date
          AND team_id <> 0
          ${countryFilter}
        GROUP BY team_id, team_name, league, team_country
        ORDER BY total_payments DESC
        LIMIT ${limit}
      `)),
      this.conn.execute(sql.raw(`
        SELECT COUNT(DISTINCT team_id)::int  AS teams,
               SUM(unique_payers)::int       AS payers,
               SUM(total_payments)::int      AS payments
        FROM basket_mat_team_monthly
        WHERE month BETWEEN '${from.toISOString().slice(0,10)}'::date
                        AND '${to.toISOString().slice(0,10)}'::date
          AND team_id <> 0
          ${countryFilter}
      `)),
    ]);

    const tot = ((totalsRows as unknown) as RowAny[])[0] ?? {};
    return {
      range,
      totals: {
        teams: n(tot.teams),
        uniquePayers: n(tot.payers),
        totalPayments: n(tot.payments),
      },
      ranked: ((rankedRows as unknown) as RowAny[]).map((r) => ({
        teamId: n(r.team_id),
        teamName: s(r.team_name),
        league: s(r.league),
        teamCountry: s(r.team_country),
        uniquePayers: n(r.unique_payers),
        totalPayments: n(r.total_payments),
        totalAmount: n(r.total_amount),
        realPayers: n(r.real_payers),
        voucherPayers: n(r.voucher_payers),
      })),
    };
  }

  async getTeamTrend(teamId: number): Promise<TeamTrendDTO> {
    const rows = await this.conn.execute(sql.raw(`
      SELECT month, team_name, unique_payers, total_amount
      FROM basket_mat_team_monthly
      WHERE team_id = ${Number(teamId)}
      ORDER BY month
    `));
    const arr = (rows as unknown) as RowAny[];
    return {
      teamId,
      teamName: s(arr[0]?.team_name ?? ''),
      points: arr.map((r) => ({
        month: d(r.month),
        uniquePayers: n(r.unique_payers),
        totalAmount: n(r.total_amount),
      })),
    };
  }

  // --------------------------------------------------------------------------
  // FINANCE — 4 aggregations against mat_revenue_daily in parallel
  // --------------------------------------------------------------------------
  async getFinance(range: DateRange, _filters?: CommonFilters): Promise<FinanceDTO> {
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
  // RETENTION — full mat_monthly_lifecycle scan (small table)
  // --------------------------------------------------------------------------
  async getRetention(): Promise<RetentionDTO> {
    const rows = await this.conn.execute(sql.raw(`
      SELECT month, active_start, active_end, new_payers, renewals,
             reactivations, expirations, churn_rate_pct, retention_rate_pct
      FROM basket_mat_monthly_lifecycle
      ORDER BY month
    `));
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
      totals: { users: v(usersC), payments: v(paymentsC), teams: v(teamsC) },
      issues: [
        { code: 'user_no_country',      description: 'Users with NULL country',                      count: v(noCountry) },
        { code: 'user_no_team',         description: 'Users with no promo team',                     count: v(noTeam) },
        { code: 'payment_orphan',       description: 'Payments whose user_id is missing from users', count: v(orphanPayments) },
        { code: 'paid_zero_non_antel',  description: 'Non-Antel paid plan with amount = 0',          count: v(zeroAmountNonAntel) },
        { code: 'payment_failed',       description: 'Payments with status = 0 (failed)',             count: v(statusZero) },
      ],
    };
  }

  async getMeta(): Promise<MetaDTO> {
    const [rangeRows, countryRows, syncRows] = await Promise.all([
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
      this.conn.execute(sql.raw(`
        SELECT source, last_sync, row_count
        FROM basket_sync_state
        ORDER BY source
      `)),
    ]);

    const rangeRow = (rangeRows as unknown as RowAny[])[0] ?? {};
    const countries = (countryRows as unknown as RowAny[]).map((r) => s(r.country));
    const lastSync = (syncRows as unknown as RowAny[]).map((r) => ({
      source: s(r.source),
      lastSync: r.last_sync instanceof Date
        ? r.last_sync.toISOString()
        : String(r.last_sync ?? ''),
      rowCount: r.row_count == null ? null : Number(r.row_count),
    }));

    return {
      dataRange: { minDay: s(rangeRow.min_day), maxDay: s(rangeRow.max_day) },
      countries,
      lastSync,
      enums: META_ENUMS,
    };
  }
}
