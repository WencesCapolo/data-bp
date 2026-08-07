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
  if (range.kind === 'custom') return range.from;
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
        WITH f AS (
          SELECT user_id, created_at::date AS start_d,
                 (expires_at + INTERVAL '7 days')::date AS end_d,
                 access_type
          FROM basket_v_active_payments
          WHERE created_at::date <= '${day}'::date
            AND (expires_at + INTERVAL '7 days')::date >= '${trendFrom}'::date
            ${fw}
        ),
        spans AS (
          SELECT user_id, access_type,
                 GREATEST(start_d, '${trendFrom}'::date) AS s,
                 LEAST(end_d, '${day}'::date) AS e
          FROM f
        ),
        per_user_day AS (
          SELECT DISTINCT user_id, access_type, gs::date AS d
          FROM spans, generate_series(s, e, '1 day'::interval) AS gs
        )
        SELECT
          d AS day,
          COUNT(DISTINCT user_id)::int AS all_active,
          COUNT(DISTINCT user_id) FILTER (WHERE access_type='real')::int    AS real_active,
          COUNT(DISTINCT user_id) FILTER (WHERE access_type='voucher')::int AS voucher_active
        FROM per_user_day
        GROUP BY d
        ORDER BY d
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
        WHERE created_at BETWEEN '${trendFrom}'::date AND '${day}'::date
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
  // EVOLUTION (filtered) — live SQL with generate_series buckets
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
      payments AS (
        SELECT user_id, created_at, expires_at, access_type, sub_type
        FROM basket_v_active_payments
        WHERE 1=1 ${fw}
      )
      SELECT
        b.b AS bucket,
        COUNT(DISTINCT user_id) FILTER (
          WHERE created_at::date <= b.b
            AND (expires_at + INTERVAL '7 days')::date >= b.b
        )::int AS all_active,
        COUNT(DISTINCT user_id) FILTER (
          WHERE access_type='real'
            AND created_at::date <= b.b
            AND (expires_at + INTERVAL '7 days')::date >= b.b
        )::int AS real_active,
        COUNT(DISTINCT user_id) FILTER (
          WHERE access_type='voucher'
            AND created_at::date <= b.b
            AND (expires_at + INTERVAL '7 days')::date >= b.b
        )::int AS voucher_active,
        COUNT(DISTINCT user_id) FILTER (
          WHERE sub_type='Free'
            AND created_at::date <= b.b
            AND (expires_at + INTERVAL '7 days')::date >= b.b
        )::int AS free_active,
        COUNT(DISTINCT user_id) FILTER (
          WHERE sub_type='Mensual_Basico'
            AND created_at::date <= b.b
            AND (expires_at + INTERVAL '7 days')::date >= b.b
        )::int AS mensual_basico_active,
        COUNT(DISTINCT user_id) FILTER (
          WHERE sub_type='Mensual_Total'
            AND created_at::date <= b.b
            AND (expires_at + INTERVAL '7 days')::date >= b.b
        )::int AS mensual_total_active,
        COUNT(DISTINCT user_id) FILTER (
          WHERE sub_type='Anual_Total'
            AND created_at::date <= b.b
            AND (expires_at + INTERVAL '7 days')::date >= b.b
        )::int AS anual_total_active
      FROM buckets b LEFT JOIN payments ON TRUE
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
        WHERE created_at::date BETWEEN '${f}'::date AND '${t}'::date ${fw} ${cf}
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
  async getFinance(range: DateRange, filters?: CommonFilters): Promise<FinanceDTO> {
    if (hasFilters(filters)) {
      return this.getFinanceFiltered(range, filters!);
    }
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
    const where = `WHERE created_at::date BETWEEN '${f}'::date AND '${t}'::date ${fw}`;

    const [byDayRows, byPlatRows, byCurRows, platMoRows] = await Promise.all([
      this.conn.execute(sql.raw(`
        SELECT created_at::date AS day, currency,
               SUM(amount)::numeric AS total_amount,
               SUM(CASE WHEN access_type='real' THEN amount ELSE 0 END)::numeric AS real_amount,
               COUNT(*)::int AS payment_count
        FROM basket_v_active_payments ${where}
        GROUP BY created_at::date, currency
        ORDER BY created_at::date, currency
      `)),
      this.conn.execute(sql.raw(`
        SELECT platform, platform_name,
               COUNT(*)::int AS payment_count,
               SUM(amount)::numeric AS total_amount,
               COUNT(*) FILTER (WHERE access_type='real')::int AS real_count,
               SUM(CASE WHEN access_type='real' THEN amount ELSE 0 END)::numeric AS real_amount
        FROM basket_v_active_payments ${where}
        GROUP BY platform, platform_name
        ORDER BY total_amount DESC
      `)),
      this.conn.execute(sql.raw(`
        SELECT currency,
               SUM(amount)::numeric AS total_amount,
               COUNT(*)::int AS payment_count
        FROM basket_v_active_payments ${where}
        GROUP BY currency
        ORDER BY total_amount DESC
      `)),
      this.conn.execute(sql.raw(`
        SELECT DATE_TRUNC('month', created_at)::date AS month,
               platform_name,
               SUM(amount)::numeric AS total_amount
        FROM basket_v_active_payments ${where}
        GROUP BY DATE_TRUNC('month', created_at), platform_name
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
