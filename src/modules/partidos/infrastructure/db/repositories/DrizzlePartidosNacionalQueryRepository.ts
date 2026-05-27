import { and, asc, eq, gte, inArray, isNotNull, lte, sql, type SQL } from 'drizzle-orm';
import { db, type Db } from '@shared/db/client';
import type { IPartidosNacionalQueryRepository } from '@partidos/core/ports/IPartidosNacionalQueryRepository';
import type { PartidosNacionalFilters } from '@partidos/core/dtos/shared';
import type { PartidosNacionalMetaDTO, PartidosWeekOption } from '@partidos/core/dtos/MetaDTO';
import type { PartidosNacionalOverviewDTO } from '@partidos/core/dtos/OverviewDTO';
import type {
  PartidosNacionalMonthlyDTO,
  PartidosNacionalMonthlyPoint,
} from '@partidos/core/dtos/MonthlyDTO';
import type {
  PartidosNacionalWeeklyDTO,
  PartidosNacionalWeeklyPoint,
} from '@partidos/core/dtos/WeeklyDTO';
import type { PartidosNacionalChannelsDTO } from '@partidos/core/dtos/ChannelsDTO';
import { partidosNacional } from '../schema';

function num(v: unknown): number {
  if (v == null) return 0;
  const n = typeof v === 'number' ? v : Number(v);
  return Number.isFinite(n) ? n : 0;
}

function isoDate(v: unknown): string {
  if (v instanceof Date) return v.toISOString().slice(0, 10);
  return String(v ?? '');
}

function buildFilters(f: PartidosNacionalFilters | undefined): SQL | undefined {
  if (!f) return undefined;
  const clauses: SQL[] = [];
  if (f.seasons?.length) clauses.push(inArray(partidosNacional.season, f.seasons));
  if (f.leagues?.length) clauses.push(inArray(partidosNacional.league, f.leagues));
  if (f.controls?.length) clauses.push(inArray(partidosNacional.control, f.controls));
  if (f.monthFrom) clauses.push(gte(partidosNacional.monthYear, f.monthFrom));
  if (f.monthTo) clauses.push(lte(partidosNacional.monthYear, f.monthTo));
  if (f.weeks?.length) {
    clauses.push(sql`(${partidosNacional.monthYear} || '__' || ${partidosNacional.weekRange}) IN ${f.weeks}`);
  }
  return clauses.length > 0 ? and(...clauses) : undefined;
}

export class DrizzlePartidosNacionalQueryRepository implements IPartidosNacionalQueryRepository {
  constructor(private readonly database: Db = db) {}

  async getMeta(): Promise<PartidosNacionalMetaDTO> {
    const seasonsRows = await this.database.execute<{ season: string }>(
      sql`SELECT DISTINCT season FROM ${partidosNacional} ORDER BY season`,
    );
    const leaguesRows = await this.database.execute<{ league: string }>(
      sql`SELECT DISTINCT league FROM ${partidosNacional} ORDER BY league`,
    );
    const controlsRows = await this.database.execute<{ control: string }>(
      sql`SELECT DISTINCT control FROM ${partidosNacional} WHERE control IS NOT NULL ORDER BY control`,
    );
    const monthsRows = await this.database.execute<{ month_year: string }>(
      sql`SELECT DISTINCT month_year FROM ${partidosNacional} ORDER BY month_year`,
    );
    const weeksRows = await this.database.execute<{
      month_year: string;
      week_range: string;
      ws: string;
    }>(sql`
      SELECT month_year, week_range, MIN(week_start)::text AS ws
      FROM ${partidosNacional}
      WHERE is_month_total = false AND week_range IS NOT NULL AND week_start IS NOT NULL
      GROUP BY month_year, week_range
      ORDER BY ws
    `);

    const seasons = (seasonsRows as unknown as Array<{ season: string }>).map((r) => r.season);
    const leagues = (leaguesRows as unknown as Array<{ league: string }>).map((r) => r.league);
    const controls = (controlsRows as unknown as Array<{ control: string }>).map((r) => r.control);
    const months = (monthsRows as unknown as Array<{ month_year: string }>).map((r) => r.month_year);
    const weeks: PartidosWeekOption[] = (
      weeksRows as unknown as Array<{ month_year: string; week_range: string; ws: string }>
    ).map((r) => ({
      key: `${r.month_year}__${r.week_range}`,
      monthYear: r.month_year,
      weekRange: r.week_range,
      weekStart: r.ws,
    }));

    const latestSeason = seasons.at(-1) ?? null;
    let latestMonth: string | null = null;
    if (latestSeason) {
      const lm = await this.database.execute<{ month_year: string }>(sql`
        SELECT MIN(month_year) AS month_year
        FROM ${partidosNacional} WHERE season = ${latestSeason}
      `);
      latestMonth = (lm as unknown as Array<{ month_year: string }>)[0]?.month_year ?? null;
    }

    return { seasons, leagues, controls, months, weeks, latestSeason, latestMonth };
  }

  async getMonthly(filters?: PartidosNacionalFilters): Promise<PartidosNacionalMonthlyDTO> {
    const where = and(eq(partidosNacional.isMonthTotal, true), buildFilters(filters));
    const rows = await this.database
      .select({
        monthYear: partidosNacional.monthYear,
        total: sql<number>`COALESCE(SUM(${partidosNacional.total}),0)::int`,
        tyc: sql<number>`COALESCE(SUM(${partidosNacional.tyc}),0)::int`,
        directTv: sql<number>`COALESCE(SUM(${partidosNacional.directTv}),0)::int`,
        bpEmitido: sql<number>`COALESCE(SUM(${partidosNacional.bpEmitido}),0)::int`,
        bpProducido: sql<number>`COALESCE(SUM(${partidosNacional.bpProducido}),0)::int`,
        externoProducido: sql<number>`COALESCE(SUM(${partidosNacional.externoProducido}),0)::int`,
      })
      .from(partidosNacional)
      .where(where)
      .groupBy(partidosNacional.monthYear)
      .orderBy(asc(partidosNacional.monthYear));

    return rows.map((r) => ({
      monthYear: r.monthYear,
      total: num(r.total),
      tyc: num(r.tyc),
      directTv: num(r.directTv),
      bpEmitido: num(r.bpEmitido),
      bpProducido: num(r.bpProducido),
      externoProducido: num(r.externoProducido),
    }));
  }

  async getWeekly(filters?: PartidosNacionalFilters): Promise<PartidosNacionalWeeklyDTO> {
    const where = and(
      eq(partidosNacional.isMonthTotal, false),
      isNotNull(partidosNacional.weekStart),
      isNotNull(partidosNacional.weekRange),
      buildFilters(filters),
    );
    const rows = await this.database
      .select({
        weekStart: sql<string>`MIN(${partidosNacional.weekStart})::text`,
        monthYear: partidosNacional.monthYear,
        weekRange: partidosNacional.weekRange,
        total: sql<number>`COALESCE(SUM(${partidosNacional.total}),0)::int`,
        tyc: sql<number>`COALESCE(SUM(${partidosNacional.tyc}),0)::int`,
        directTv: sql<number>`COALESCE(SUM(${partidosNacional.directTv}),0)::int`,
        bpEmitido: sql<number>`COALESCE(SUM(${partidosNacional.bpEmitido}),0)::int`,
        bpProducido: sql<number>`COALESCE(SUM(${partidosNacional.bpProducido}),0)::int`,
        externoProducido: sql<number>`COALESCE(SUM(${partidosNacional.externoProducido}),0)::int`,
      })
      .from(partidosNacional)
      .where(where)
      .groupBy(partidosNacional.monthYear, partidosNacional.weekRange)
      .orderBy(sql`MIN(${partidosNacional.weekStart})`);

    return rows.map<PartidosNacionalWeeklyPoint>((r) => ({
      weekStart: isoDate(r.weekStart),
      monthYear: r.monthYear,
      weekRange: r.weekRange ?? '',
      total: num(r.total),
      tyc: num(r.tyc),
      directTv: num(r.directTv),
      bpEmitido: num(r.bpEmitido),
      bpProducido: num(r.bpProducido),
      externoProducido: num(r.externoProducido),
    }));
  }

  async getOverview(filters?: PartidosNacionalFilters): Promise<PartidosNacionalOverviewDTO> {
    const [monthly, weekly] = await Promise.all([this.getMonthly(filters), this.getWeekly(filters)]);
    return computeNacionalKpis(monthly, weekly);
  }

  async getChannels(filters?: PartidosNacionalFilters): Promise<PartidosNacionalChannelsDTO> {
    const where = and(eq(partidosNacional.isMonthTotal, true), buildFilters(filters));
    const byLeagueRows = await this.database
      .select({
        league: partidosNacional.league,
        total: sql<number>`COALESCE(SUM(${partidosNacional.total}),0)::int`,
        tyc: sql<number>`COALESCE(SUM(${partidosNacional.tyc}),0)::int`,
        directTv: sql<number>`COALESCE(SUM(${partidosNacional.directTv}),0)::int`,
        bpEmitido: sql<number>`COALESCE(SUM(${partidosNacional.bpEmitido}),0)::int`,
        bpProducido: sql<number>`COALESCE(SUM(${partidosNacional.bpProducido}),0)::int`,
        externoProducido: sql<number>`COALESCE(SUM(${partidosNacional.externoProducido}),0)::int`,
      })
      .from(partidosNacional)
      .where(where)
      .groupBy(partidosNacional.league)
      .orderBy(sql`SUM(${partidosNacional.total}) DESC`);

    const byLeague = byLeagueRows.map((r) => ({
      league: r.league,
      total: num(r.total),
      tyc: num(r.tyc),
      directTv: num(r.directTv),
      bpEmitido: num(r.bpEmitido),
      bpProducido: num(r.bpProducido),
      externoProducido: num(r.externoProducido),
    }));

    const totals = byLeague.reduce(
      (acc, r) => {
        acc.total += r.total;
        acc.tyc += r.tyc;
        acc.directTv += r.directTv;
        acc.bpEmitido += r.bpEmitido;
        acc.bpProducido += r.bpProducido;
        acc.externoProducido += r.externoProducido;
        return acc;
      },
      { total: 0, tyc: 0, directTv: 0, bpEmitido: 0, bpProducido: 0, externoProducido: 0 },
    );

    return { ...totals, byLeague };
  }
}

function computeNacionalKpis(
  monthly: PartidosNacionalMonthlyPoint[],
  weekly: PartidosNacionalWeeklyPoint[],
): PartidosNacionalOverviewDTO {
  const lastMonth = monthly.at(-1);
  const prevMonth = monthly.at(-2);
  const lastWeek = weekly.at(-1);
  const prevWeek = weekly.at(-2);
  const totalSeason = monthly.reduce((s, m) => s + m.total, 0);
  const avgWeek = weekly.length ? weekly.reduce((s, w) => s + w.total, 0) / weekly.length : 0;
  return {
    totalSeason,
    totalMonth: lastMonth?.total ?? 0,
    totalWeek: lastWeek?.total ?? 0,
    avgWeek: Math.round(avgWeek * 10) / 10,
    deltaMonth: lastMonth && prevMonth ? lastMonth.total - prevMonth.total : null,
    deltaWeek: lastWeek && prevWeek ? lastWeek.total - prevWeek.total : null,
    lastMonthLabel: lastMonth?.monthYear ?? null,
    lastWeekLabel: lastWeek ? `${lastWeek.monthYear} · ${lastWeek.weekRange}` : null,
  };
}
