import { and, asc, eq, gte, inArray, isNotNull, lte, sql, type SQL } from 'drizzle-orm';
import { db, type Db } from '@shared/db/client';
import type { IPartidosIntlQueryRepository } from '@partidos/core/ports/IPartidosIntlQueryRepository';
import type { PartidosIntlFilters } from '@partidos/core/dtos/shared';
import type { PartidosIntlMetaDTO, PartidosWeekOption } from '@partidos/core/dtos/MetaDTO';
import type { PartidosIntlOverviewDTO } from '@partidos/core/dtos/OverviewDTO';
import type {
  PartidosIntlMonthlyDTO,
  PartidosIntlMonthlyPoint,
} from '@partidos/core/dtos/MonthlyDTO';
import type {
  PartidosIntlWeeklyDTO,
  PartidosIntlWeeklyPoint,
} from '@partidos/core/dtos/WeeklyDTO';
import type { PartidosIntlChannelsDTO } from '@partidos/core/dtos/ChannelsDTO';
import { partidosIntl } from '../schema';

function num(v: unknown): number {
  if (v == null) return 0;
  const n = typeof v === 'number' ? v : Number(v);
  return Number.isFinite(n) ? n : 0;
}

function isoDate(v: unknown): string {
  if (v instanceof Date) return v.toISOString().slice(0, 10);
  return String(v ?? '');
}

function buildFilters(f: PartidosIntlFilters | undefined): SQL | undefined {
  if (!f) return undefined;
  const clauses: SQL[] = [];
  if (f.seasons?.length) clauses.push(inArray(partidosIntl.season, f.seasons));
  if (f.countries?.length) clauses.push(inArray(partidosIntl.country, f.countries));
  if (f.leagues?.length) clauses.push(inArray(partidosIntl.league, f.leagues));
  if (f.monthFrom) clauses.push(gte(partidosIntl.monthYear, f.monthFrom));
  if (f.monthTo) clauses.push(lte(partidosIntl.monthYear, f.monthTo));
  if (f.weeks?.length) {
    clauses.push(sql`(${partidosIntl.monthYear} || '__' || ${partidosIntl.weekRange}) IN ${f.weeks}`);
  }
  return clauses.length > 0 ? and(...clauses) : undefined;
}

export class DrizzlePartidosIntlQueryRepository implements IPartidosIntlQueryRepository {
  constructor(private readonly database: Db = db) {}

  async getMeta(): Promise<PartidosIntlMetaDTO> {
    const seasonsRows = await this.database.execute<{ season: string }>(
      sql`SELECT DISTINCT season FROM ${partidosIntl} ORDER BY season`,
    );
    const countriesRows = await this.database.execute<{ country: string }>(
      sql`SELECT DISTINCT country FROM ${partidosIntl} ORDER BY country`,
    );
    const leaguesRows = await this.database.execute<{ league: string }>(
      sql`SELECT DISTINCT league FROM ${partidosIntl} ORDER BY league`,
    );
    const monthsRows = await this.database.execute<{ month_year: string }>(
      sql`SELECT DISTINCT month_year FROM ${partidosIntl} ORDER BY month_year`,
    );
    const weeksRows = await this.database.execute<{
      month_year: string;
      week_range: string;
      ws: string;
    }>(sql`
      SELECT month_year, week_range, MIN(week_start)::text AS ws
      FROM ${partidosIntl}
      WHERE is_month_total = false AND week_range IS NOT NULL AND week_start IS NOT NULL
      GROUP BY month_year, week_range
      ORDER BY ws
    `);

    const seasons = (seasonsRows as unknown as Array<{ season: string }>).map((r) => r.season);
    const countries = (countriesRows as unknown as Array<{ country: string }>).map((r) => r.country);
    const leagues = (leaguesRows as unknown as Array<{ league: string }>).map((r) => r.league);
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
        FROM ${partidosIntl} WHERE season = ${latestSeason}
      `);
      latestMonth = (lm as unknown as Array<{ month_year: string }>)[0]?.month_year ?? null;
    }

    return { seasons, countries, leagues, months, weeks, latestSeason, latestMonth };
  }

  async getMonthly(filters?: PartidosIntlFilters): Promise<PartidosIntlMonthlyDTO> {
    const where = and(eq(partidosIntl.isMonthTotal, true), buildFilters(filters));
    const rows = await this.database
      .select({
        monthYear: partidosIntl.monthYear,
        total: sql<number>`COALESCE(SUM(${partidosIntl.total}),0)::int`,
        totalArg: sql<number>`COALESCE(SUM(${partidosIntl.totalArg}),0)::int`,
        totalFuera: sql<number>`COALESCE(SUM(${partidosIntl.totalFuera}),0)::int`,
        bpEmitido: sql<number>`COALESCE(SUM(${partidosIntl.bpEmitido}),0)::int`,
        bpProducido: sql<number>`COALESCE(SUM(${partidosIntl.bpProducido}),0)::int`,
        externoProducido: sql<number>`COALESCE(SUM(${partidosIntl.externoProducido}),0)::int`,
      })
      .from(partidosIntl)
      .where(where)
      .groupBy(partidosIntl.monthYear)
      .orderBy(asc(partidosIntl.monthYear));

    return rows.map<PartidosIntlMonthlyPoint>((r) => ({
      monthYear: r.monthYear,
      total: num(r.total),
      totalArg: num(r.totalArg),
      totalFuera: num(r.totalFuera),
      bpEmitido: num(r.bpEmitido),
      bpProducido: num(r.bpProducido),
      externoProducido: num(r.externoProducido),
    }));
  }

  async getWeekly(filters?: PartidosIntlFilters): Promise<PartidosIntlWeeklyDTO> {
    const where = and(
      eq(partidosIntl.isMonthTotal, false),
      isNotNull(partidosIntl.weekStart),
      isNotNull(partidosIntl.weekRange),
      buildFilters(filters),
    );
    const rows = await this.database
      .select({
        weekStart: sql<string>`MIN(${partidosIntl.weekStart})::text`,
        monthYear: partidosIntl.monthYear,
        weekRange: partidosIntl.weekRange,
        total: sql<number>`COALESCE(SUM(${partidosIntl.total}),0)::int`,
        totalArg: sql<number>`COALESCE(SUM(${partidosIntl.totalArg}),0)::int`,
        totalFuera: sql<number>`COALESCE(SUM(${partidosIntl.totalFuera}),0)::int`,
        bpEmitido: sql<number>`COALESCE(SUM(${partidosIntl.bpEmitido}),0)::int`,
        bpProducido: sql<number>`COALESCE(SUM(${partidosIntl.bpProducido}),0)::int`,
        externoProducido: sql<number>`COALESCE(SUM(${partidosIntl.externoProducido}),0)::int`,
      })
      .from(partidosIntl)
      .where(where)
      .groupBy(partidosIntl.monthYear, partidosIntl.weekRange)
      .orderBy(sql`MIN(${partidosIntl.weekStart})`);

    return rows.map<PartidosIntlWeeklyPoint>((r) => ({
      weekStart: isoDate(r.weekStart),
      monthYear: r.monthYear,
      weekRange: r.weekRange ?? '',
      total: num(r.total),
      totalArg: num(r.totalArg),
      totalFuera: num(r.totalFuera),
      bpEmitido: num(r.bpEmitido),
      bpProducido: num(r.bpProducido),
      externoProducido: num(r.externoProducido),
    }));
  }

  async getOverview(filters?: PartidosIntlFilters): Promise<PartidosIntlOverviewDTO> {
    const monthly = await this.getMonthly(filters);
    const lastMonth = monthly.at(-1);
    const totalSeason = monthly.reduce((s, m) => s + m.total, 0);
    return {
      totalSeason,
      totalMonth: lastMonth?.total ?? 0,
      totalArg: monthly.reduce((s, m) => s + m.totalArg, 0),
      totalFuera: monthly.reduce((s, m) => s + m.totalFuera, 0),
      bpEmitido: monthly.reduce((s, m) => s + m.bpEmitido, 0),
      bpProducido: monthly.reduce((s, m) => s + m.bpProducido, 0),
      externoProducido: monthly.reduce((s, m) => s + m.externoProducido, 0),
      lastMonthLabel: lastMonth?.monthYear ?? null,
    };
  }

  async getChannels(filters?: PartidosIntlFilters): Promise<PartidosIntlChannelsDTO> {
    const where = and(eq(partidosIntl.isMonthTotal, true), buildFilters(filters));
    const byCountryRows = await this.database
      .select({
        country: partidosIntl.country,
        total: sql<number>`COALESCE(SUM(${partidosIntl.total}),0)::int`,
        totalArg: sql<number>`COALESCE(SUM(${partidosIntl.totalArg}),0)::int`,
        totalFuera: sql<number>`COALESCE(SUM(${partidosIntl.totalFuera}),0)::int`,
        bpEmitido: sql<number>`COALESCE(SUM(${partidosIntl.bpEmitido}),0)::int`,
        bpProducido: sql<number>`COALESCE(SUM(${partidosIntl.bpProducido}),0)::int`,
        externoProducido: sql<number>`COALESCE(SUM(${partidosIntl.externoProducido}),0)::int`,
      })
      .from(partidosIntl)
      .where(where)
      .groupBy(partidosIntl.country)
      .orderBy(sql`SUM(${partidosIntl.total}) DESC`);

    const byCountry = byCountryRows.map((r) => ({
      country: r.country,
      total: num(r.total),
      totalArg: num(r.totalArg),
      totalFuera: num(r.totalFuera),
      bpEmitido: num(r.bpEmitido),
      bpProducido: num(r.bpProducido),
      externoProducido: num(r.externoProducido),
    }));

    const totals = byCountry.reduce(
      (acc, r) => {
        acc.total += r.total;
        acc.totalArg += r.totalArg;
        acc.totalFuera += r.totalFuera;
        acc.bpEmitido += r.bpEmitido;
        acc.bpProducido += r.bpProducido;
        acc.externoProducido += r.externoProducido;
        return acc;
      },
      {
        total: 0,
        totalArg: 0,
        totalFuera: 0,
        bpEmitido: 0,
        bpProducido: 0,
        externoProducido: 0,
      },
    );

    return { ...totals, byCountry };
  }
}
