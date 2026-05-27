import { LEAGUES, type League } from "./constants";
import type { PartidoRecord } from "./types";

export type Filters = {
  seasons: string[];
  leagues: League[];
  controls: string[];
  monthFrom: string | null;
  monthTo: string | null;
  weeks: string[];
};

export const EMPTY_FILTERS: Filters = {
  seasons: [],
  leagues: [],
  controls: [],
  monthFrom: null,
  monthTo: null,
  weeks: [],
};

export function weekKey(monthYear: string, weekRange: string): string {
  return `${monthYear}__${weekRange}`;
}

function inRange(monthYear: string, from: string | null, to: string | null): boolean {
  if (from && monthYear < from) return false;
  if (to && monthYear > to) return false;
  return true;
}

export function applyFilters(records: PartidoRecord[], f: Filters): PartidoRecord[] {
  return records.filter((r) => {
    if (f.seasons.length && !f.seasons.includes(r.season)) return false;
    if (f.leagues.length && !f.leagues.includes(r.league)) return false;
    if (f.controls.length && (!r.control || !f.controls.includes(r.control))) return false;
    if (!inRange(r.monthYear, f.monthFrom, f.monthTo)) return false;
    if (f.weeks.length) {
      if (r.isMonthTotal || !r.weekRange) return false;
      if (!f.weeks.includes(weekKey(r.monthYear, r.weekRange))) return false;
    }
    return true;
  });
}

export function uniqueSeasons(records: PartidoRecord[]): string[] {
  return Array.from(new Set(records.map((r) => r.season))).sort();
}

export function uniqueControls(records: PartidoRecord[]): string[] {
  return Array.from(
    new Set(records.filter((r) => r.control).map((r) => r.control!)),
  ).sort();
}

export function uniqueMonths(records: PartidoRecord[]): string[] {
  return Array.from(new Set(records.map((r) => r.monthYear))).sort();
}

export function latestSeasonFirstMonth(records: PartidoRecord[]): string | null {
  const seasons = uniqueSeasons(records);
  const latest = seasons.at(-1);
  if (!latest) return null;
  const months = records
    .filter((r) => r.season === latest)
    .map((r) => r.monthYear)
    .sort();
  return months[0] ?? null;
}

export type WeekOption = { key: string; monthYear: string; weekRange: string; weekStart: string };

export function uniqueWeeks(records: PartidoRecord[]): WeekOption[] {
  const map = new Map<string, WeekOption>();
  for (const r of records) {
    if (r.isMonthTotal || !r.weekRange || !r.weekStart) continue;
    const key = weekKey(r.monthYear, r.weekRange);
    if (map.has(key)) continue;
    map.set(key, {
      key,
      monthYear: r.monthYear,
      weekRange: r.weekRange,
      weekStart: r.weekStart.toISOString().slice(0, 10),
    });
  }
  return Array.from(map.values()).sort((a, b) => a.weekStart.localeCompare(b.weekStart));
}

export type WeeklyPoint = {
  weekStart: string;
  monthYear: string;
  weekRange: string;
  total: number;
  tyc: number;
  directTv: number;
  bpEmitido: number;
  bpProducido: number;
  externoProducido: number;
};

export function weeklySeries(records: PartidoRecord[]): WeeklyPoint[] {
  const map = new Map<string, WeeklyPoint>();
  for (const r of records) {
    if (r.isMonthTotal || !r.weekStart || !r.weekRange) continue;
    const key = `${r.monthYear}__${r.weekRange}`;
    const cur = map.get(key) ?? {
      weekStart: r.weekStart.toISOString().slice(0, 10),
      monthYear: r.monthYear,
      weekRange: r.weekRange,
      total: 0,
      tyc: 0,
      directTv: 0,
      bpEmitido: 0,
      bpProducido: 0,
      externoProducido: 0,
    };
    cur.total += r.total;
    cur.tyc += r.tyc ?? 0;
    cur.directTv += r.directTv ?? 0;
    cur.bpEmitido += r.bpEmitido;
    cur.bpProducido += r.bpProducido;
    cur.externoProducido += r.externoProducido;
    map.set(key, cur);
  }
  return Array.from(map.values()).sort((a, b) =>
    a.weekStart.localeCompare(b.weekStart),
  );
}

export type MonthlyPoint = {
  monthYear: string;
  total: number;
  tyc: number;
  directTv: number;
  bpEmitido: number;
  bpProducido: number;
  externoProducido: number;
};

export function monthlySeries(records: PartidoRecord[]): MonthlyPoint[] {
  const map = new Map<string, MonthlyPoint>();
  for (const r of records) {
    if (!r.isMonthTotal) continue;
    const cur = map.get(r.monthYear) ?? {
      monthYear: r.monthYear,
      total: 0,
      tyc: 0,
      directTv: 0,
      bpEmitido: 0,
      bpProducido: 0,
      externoProducido: 0,
    };
    cur.total += r.total;
    cur.tyc += r.tyc ?? 0;
    cur.directTv += r.directTv ?? 0;
    cur.bpEmitido += r.bpEmitido;
    cur.bpProducido += r.bpProducido;
    cur.externoProducido += r.externoProducido;
    map.set(r.monthYear, cur);
  }
  return Array.from(map.values()).sort((a, b) =>
    a.monthYear.localeCompare(b.monthYear),
  );
}

export type LeaguePivotCell = { league: League; monthYear: string; total: number };

export function leaguePivot(records: PartidoRecord[]): LeaguePivotCell[] {
  const cells: LeaguePivotCell[] = [];
  for (const league of LEAGUES) {
    const months = new Map<string, number>();
    for (const r of records) {
      if (r.league !== league || !r.isMonthTotal) continue;
      months.set(r.monthYear, (months.get(r.monthYear) ?? 0) + r.total);
    }
    for (const [monthYear, total] of months) cells.push({ league, monthYear, total });
  }
  return cells;
}

export type ControlSummaryRow = {
  control: string;
  weeks: number;
  total: number;
};

export function controlSummary(records: PartidoRecord[]): ControlSummaryRow[] {
  const map = new Map<string, { weeks: Set<string>; total: number }>();
  for (const r of records) {
    if (!r.control || r.isMonthTotal) continue;
    const cur = map.get(r.control) ?? { weeks: new Set(), total: 0 };
    cur.weeks.add(`${r.monthYear}__${r.weekRange}`);
    cur.total += r.total;
    map.set(r.control, cur);
  }
  return Array.from(map.entries())
    .map(([control, v]) => ({ control, weeks: v.weeks.size, total: v.total }))
    .sort((a, b) => b.total - a.total);
}

export type KpiSummary = {
  totalSeason: number;
  totalMonth: number;
  totalWeek: number;
  avgWeek: number;
  deltaMonth: number | null;
  deltaWeek: number | null;
  lastMonthLabel: string | null;
  lastWeekLabel: string | null;
};

export function kpis(records: PartidoRecord[]): KpiSummary {
  const monthly = monthlySeries(records);
  const weekly = weeklySeries(records);
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
