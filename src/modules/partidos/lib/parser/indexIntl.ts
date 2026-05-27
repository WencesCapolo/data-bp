import {
  HEADER_ROW_COUNT_INTL,
  INTL_LEAGUE_COUNTRY,
  MONTH_TOTAL_LABEL,
  SEASON_BANNER_PATTERN,
} from "../constants";
import type { IntlLeague, IntlMetric, PartidoIntlRecord } from "../types";
import {
  CONTROL_COL,
  INTL_COLUMN_SPECS,
  MONTH_COL,
  ROLLUP_MAP,
  WEEK_COL,
} from "./columnSpecsIntl";
import { parseMonthCell, toMonthYear } from "./monthName";
import { parseWeekRange, weekRangeToDates } from "./weekRange";

type Acc = Partial<Record<IntlMetric, number>> & { hasData: boolean };
type LeagueAcc = Record<string, Acc>;

function toNumber(cell: string | undefined): number {
  if (!cell) return 0;
  const n = Number(cell.replace(/\s+/g, "").replace(",", "."));
  return Number.isFinite(n) ? n : 0;
}

function isSeasonBanner(row: string[]): boolean {
  const first = (row[0] ?? "").trim();
  return SEASON_BANNER_PATTERN.test(first);
}

function isEmptyDataRow(row: string[]): boolean {
  return (
    row.slice(MONTH_COL, CONTROL_COL + 1).every((c) => !c?.trim()) &&
    row.slice(3).every((c) => !c?.trim())
  );
}

function buildAccumulator(row: string[]): LeagueAcc {
  const acc: LeagueAcc = {};
  for (const [colStr, spec] of Object.entries(INTL_COLUMN_SPECS)) {
    const col = Number(colStr);
    const value = toNumber(row[col]);
    const key = spec.league;
    acc[key] = acc[key] ?? { hasData: false };
    acc[key][spec.metric] = value;
    if (value !== 0) acc[key].hasData = true;
  }
  return acc;
}

function makeRecord(
  league: IntlLeague,
  m: Acc,
  ctx: {
    season: string;
    monthYear: string;
    weekRange: string | null;
    weekStart: Date | null;
    weekEnd: Date | null;
    isMonthTotal: boolean;
  },
): PartidoIntlRecord {
  const granular: PartidoIntlRecord["granular"] = {};
  let bpProd = m.bpProducido ?? 0;
  let extProd = m.externoProducido ?? 0;

  for (const [key, target] of Object.entries(ROLLUP_MAP)) {
    const v = m[key as IntlMetric];
    if (v === undefined) continue;
    (granular as Record<string, number>)[key] = v;
    if (target === "bpProducido") bpProd += v;
    else extProd += v;
  }

  return {
    ...ctx,
    country: INTL_LEAGUE_COUNTRY[league],
    league,
    total: m.total ?? 0,
    totalArg: m.totalArg ?? null,
    totalFuera: m.totalFuera ?? null,
    bpEmitido: m.bpEmitido ?? 0,
    bpProducido: bpProd,
    externoProducido: extProd,
    granular,
  };
}

export function parseIntlRows(rows: string[][]): PartidoIntlRecord[] {
  const records: PartidoIntlRecord[] = [];
  let currentSeason = "";
  let currentMonth = 0;
  let currentYear = 0;
  let currentMonthYear = "";

  for (let i = HEADER_ROW_COUNT_INTL; i < rows.length; i++) {
    const row = rows[i];
    if (!row || isEmptyDataRow(row)) continue;

    if (isSeasonBanner(row)) {
      currentSeason = row[0].trim();
      continue;
    }

    const monthCell = (row[MONTH_COL] ?? "").trim();
    if (monthCell) {
      const { month, year } = parseMonthCell(monthCell);
      currentMonth = month;
      currentYear = year;
      currentMonthYear = toMonthYear(month, year);
    }

    if (!currentSeason || !currentMonthYear) continue;

    const weekCell = (row[WEEK_COL] ?? "").trim();
    const isMonthTotal =
      weekCell.toLowerCase() === MONTH_TOTAL_LABEL.toLowerCase();

    let weekRange: string | null = null;
    let weekStart: Date | null = null;
    let weekEnd: Date | null = null;
    if (!isMonthTotal && weekCell) {
      const parsed = parseWeekRange(weekCell);
      weekRange = `${parsed.start} - ${parsed.end}`;
      const dates = weekRangeToDates(parsed, currentMonth, currentYear);
      weekStart = dates.weekStart;
      weekEnd = dates.weekEnd;
    }

    const acc = buildAccumulator(row);
    for (const [league, metrics] of Object.entries(acc)) {
      if (!metrics.hasData) continue;
      records.push(
        makeRecord(league as IntlLeague, metrics, {
          season: currentSeason,
          monthYear: currentMonthYear,
          weekRange,
          weekStart,
          weekEnd,
          isMonthTotal,
        }),
      );
    }
  }

  return records;
}
