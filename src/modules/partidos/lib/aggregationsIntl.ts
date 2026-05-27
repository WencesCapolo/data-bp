import { COUNTRIES, INTL_LEAGUES, type Country, type IntlLeague } from "./constants";
import type { PartidoIntlRecord } from "./types";

export type FibaSplit = "all" | "arg" | "fuera";

export type IntlFilters = {
  seasons: string[];
  countries: Country[];
  leagues: IntlLeague[];
  monthFrom: string | null;
  monthTo: string | null;
  weeks: string[];
  fibaSplit: FibaSplit;
};

export const EMPTY_INTL_FILTERS: IntlFilters = {
  seasons: [],
  countries: [],
  leagues: [],
  monthFrom: null,
  monthTo: null,
  weeks: [],
  fibaSplit: "all",
};

export const GRANULAR_METRICS = [
  "sinTv",
  "tvUruguay",
  "senalCompleta",
  "offtube",
  "envioSenalCompleta",
  "recibidosAtm",
  "enviadosSportian",
  "emitidosCdo",
  "enviosSynergy",
  "emitidosTvn",
] as const;
export type GranularMetric = (typeof GRANULAR_METRICS)[number];

export const GRANULAR_LABEL: Record<GranularMetric, string> = {
  sinTv: "Sin TV",
  tvUruguay: "TV Uruguay",
  senalCompleta: "Señal completa",
  offtube: "Offtube",
  envioSenalCompleta: "Envío señal completa",
  recibidosAtm: "Recibidos ATM",
  enviadosSportian: "Enviados Sportian",
  emitidosCdo: "Emitidos CDO",
  enviosSynergy: "Envíos Synergy",
  emitidosTvn: "Emitidos TVN",
};

export const GRANULAR_COLOR: Record<GranularMetric, string> = {
  sinTv: "#94a3b8",
  tvUruguay: "#0ea5e9",
  senalCompleta: "#10b981",
  offtube: "#84cc16",
  envioSenalCompleta: "#22c55e",
  recibidosAtm: "#f59e0b",
  enviadosSportian: "#f97316",
  emitidosCdo: "#a855f7",
  enviosSynergy: "#ec4899",
  emitidosTvn: "#ef4444",
};

export const ROLLED_KEYS = ["bpProducido", "externoProducido"] as const;
export type RolledKey = (typeof ROLLED_KEYS)[number];

export const ROLLED_LABEL: Record<RolledKey, string> = {
  bpProducido: "BP producido",
  externoProducido: "Externo producido",
};

export const ROLLED_COLOR: Record<RolledKey, string> = {
  bpProducido: "#c62c2c",
  externoProducido: "#0ea5e9",
};

export function weekKey(monthYear: string, weekRange: string): string {
  return `${monthYear}__${weekRange}`;
}

function inRange(monthYear: string, from: string | null, to: string | null): boolean {
  if (from && monthYear < from) return false;
  if (to && monthYear > to) return false;
  return true;
}

export function applyIntlFilters(
  records: PartidoIntlRecord[],
  f: IntlFilters,
): PartidoIntlRecord[] {
  return records.filter((r) => {
    if (f.seasons.length && !f.seasons.includes(r.season)) return false;
    if (f.countries.length && !f.countries.includes(r.country)) return false;
    if (f.leagues.length && !f.leagues.includes(r.league)) return false;
    if (!inRange(r.monthYear, f.monthFrom, f.monthTo)) return false;
    if (f.weeks.length) {
      if (r.isMonthTotal || !r.weekRange) return false;
      if (!f.weeks.includes(weekKey(r.monthYear, r.weekRange))) return false;
    }
    return true;
  });
}

function totalFor(r: PartidoIntlRecord, split: FibaSplit): number {
  if (r.country === "FIBA" && split !== "all") {
    if (split === "arg") return r.totalArg ?? 0;
    return r.totalFuera ?? 0;
  }
  return r.total;
}

export function uniqueIntlSeasons(records: PartidoIntlRecord[]): string[] {
  return Array.from(new Set(records.map((r) => r.season))).sort();
}

export function uniqueIntlCountries(records: PartidoIntlRecord[]): Country[] {
  const present = new Set(records.map((r) => r.country));
  return COUNTRIES.filter((c) => present.has(c));
}

export function uniqueIntlLeagues(records: PartidoIntlRecord[]): IntlLeague[] {
  const present = new Set(records.map((r) => r.league));
  return INTL_LEAGUES.filter((l) => present.has(l));
}

export function uniqueIntlMonths(records: PartidoIntlRecord[]): string[] {
  return Array.from(new Set(records.map((r) => r.monthYear))).sort();
}

export function latestIntlSeasonFirstMonth(
  records: PartidoIntlRecord[],
): string | null {
  const seasons = uniqueIntlSeasons(records);
  const latest = seasons.at(-1);
  if (!latest) return null;
  const months = records
    .filter((r) => r.season === latest)
    .map((r) => r.monthYear)
    .sort();
  return months[0] ?? null;
}

export type WeekOption = {
  key: string;
  monthYear: string;
  weekRange: string;
  weekStart: string;
};

export function uniqueIntlWeeks(records: PartidoIntlRecord[]): WeekOption[] {
  const map = new Map<string, WeekOption>();
  for (const r of records) {
    if (r.isMonthTotal || !r.weekRange || !r.weekStart) continue;
    const k = weekKey(r.monthYear, r.weekRange);
    if (map.has(k)) continue;
    map.set(k, {
      key: k,
      monthYear: r.monthYear,
      weekRange: r.weekRange,
      weekStart: r.weekStart.toISOString().slice(0, 10),
    });
  }
  return Array.from(map.values()).sort((a, b) =>
    a.weekStart.localeCompare(b.weekStart),
  );
}

export type IntlWeeklyPoint = {
  weekStart: string;
  monthYear: string;
  weekRange: string;
  total: number;
  bpEmitido: number;
  bpProducido: number;
  externoProducido: number;
} & Partial<Record<GranularMetric, number>>;

export function intlWeeklySeries(
  records: PartidoIntlRecord[],
  split: FibaSplit = "all",
): IntlWeeklyPoint[] {
  const map = new Map<string, IntlWeeklyPoint>();
  for (const r of records) {
    if (r.isMonthTotal || !r.weekStart || !r.weekRange) continue;
    const k = `${r.monthYear}__${r.weekRange}`;
    const cur =
      map.get(k) ??
      ({
        weekStart: r.weekStart.toISOString().slice(0, 10),
        monthYear: r.monthYear,
        weekRange: r.weekRange,
        total: 0,
        bpEmitido: 0,
        bpProducido: 0,
        externoProducido: 0,
      } as IntlWeeklyPoint);
    cur.total += totalFor(r, split);
    cur.bpEmitido += r.bpEmitido;
    cur.bpProducido += r.bpProducido;
    cur.externoProducido += r.externoProducido;
    for (const m of GRANULAR_METRICS) {
      const v = r.granular[m];
      if (v === undefined) continue;
      cur[m] = (cur[m] ?? 0) + v;
    }
    map.set(k, cur);
  }
  return Array.from(map.values()).sort((a, b) =>
    a.weekStart.localeCompare(b.weekStart),
  );
}

export type IntlMonthlyPoint = {
  monthYear: string;
  total: number;
  bpEmitido: number;
  bpProducido: number;
  externoProducido: number;
} & Partial<Record<GranularMetric, number>>;

export function intlMonthlySeries(
  records: PartidoIntlRecord[],
  split: FibaSplit = "all",
): IntlMonthlyPoint[] {
  const map = new Map<string, IntlMonthlyPoint>();
  for (const r of records) {
    if (!r.isMonthTotal) continue;
    const cur =
      map.get(r.monthYear) ??
      ({
        monthYear: r.monthYear,
        total: 0,
        bpEmitido: 0,
        bpProducido: 0,
        externoProducido: 0,
      } as IntlMonthlyPoint);
    cur.total += totalFor(r, split);
    cur.bpEmitido += r.bpEmitido;
    cur.bpProducido += r.bpProducido;
    cur.externoProducido += r.externoProducido;
    for (const m of GRANULAR_METRICS) {
      const v = r.granular[m];
      if (v === undefined) continue;
      cur[m] = (cur[m] ?? 0) + v;
    }
    map.set(r.monthYear, cur);
  }
  return Array.from(map.values()).sort((a, b) =>
    a.monthYear.localeCompare(b.monthYear),
  );
}

export type IntlKpiSummary = {
  totalSeason: number;
  totalMonth: number;
  totalWeek: number;
  avgWeek: number;
  deltaMonth: number | null;
  deltaWeek: number | null;
  lastMonthLabel: string | null;
  lastWeekLabel: string | null;
  fibaTotalArg: number | null;
  fibaTotalFuera: number | null;
};

export function intlKpis(
  records: PartidoIntlRecord[],
  split: FibaSplit = "all",
): IntlKpiSummary {
  const monthly = intlMonthlySeries(records, split);
  const weekly = intlWeeklySeries(records, split);
  const lastMonth = monthly.at(-1);
  const prevMonth = monthly.at(-2);
  const lastWeek = weekly.at(-1);
  const prevWeek = weekly.at(-2);
  const totalSeason = monthly.reduce((s, m) => s + m.total, 0);
  const avgWeek = weekly.length
    ? weekly.reduce((s, w) => s + w.total, 0) / weekly.length
    : 0;

  let fibaArg: number | null = null;
  let fibaFuera: number | null = null;
  const fibaRows = records.filter(
    (r) => r.country === "FIBA" && r.isMonthTotal,
  );
  if (fibaRows.length) {
    fibaArg = fibaRows.reduce((s, r) => s + (r.totalArg ?? 0), 0);
    fibaFuera = fibaRows.reduce((s, r) => s + (r.totalFuera ?? 0), 0);
  }

  return {
    totalSeason,
    totalMonth: lastMonth?.total ?? 0,
    totalWeek: lastWeek?.total ?? 0,
    avgWeek: Math.round(avgWeek * 10) / 10,
    deltaMonth: lastMonth && prevMonth ? lastMonth.total - prevMonth.total : null,
    deltaWeek: lastWeek && prevWeek ? lastWeek.total - prevWeek.total : null,
    lastMonthLabel: lastMonth?.monthYear ?? null,
    lastWeekLabel: lastWeek
      ? `${lastWeek.monthYear} · ${lastWeek.weekRange}`
      : null,
    fibaTotalArg: fibaArg,
    fibaTotalFuera: fibaFuera,
  };
}

export function activeGranularMetrics(
  points: { [k in GranularMetric]?: number }[],
): GranularMetric[] {
  return GRANULAR_METRICS.filter((m) =>
    points.some((p) => (p[m] ?? 0) > 0),
  );
}
