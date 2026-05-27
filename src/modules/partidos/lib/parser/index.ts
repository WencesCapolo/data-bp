import {
  HEADER_ROW_COUNT,
  MONTH_TOTAL_LABEL,
  SEASON_BANNER_PATTERN,
} from "../constants";
import type { Metric, PartidoRecord } from "../types";
import {
  COLUMN_SPECS,
  CONTROL_COL,
  MONTH_COL,
  WEEK_COL,
} from "./columnSpecs";
import { parseMonthCell, toMonthYear } from "./monthName";
import { parseWeekRange, weekRangeToDates } from "./weekRange";

type LeagueAccumulator = Record<
  string,
  Partial<Record<Metric, number>> & { hasData: boolean }
>;

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
  return row.slice(MONTH_COL, CONTROL_COL + 1).every((c) => !c?.trim()) &&
    row.slice(3).every((c) => !c?.trim());
}

function buildLeagueAccumulator(row: string[]): LeagueAccumulator {
  const acc: LeagueAccumulator = {};
  for (const [colStr, spec] of Object.entries(COLUMN_SPECS)) {
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
  league: string,
  metrics: Partial<Record<Metric, number>>,
  context: {
    season: string;
    monthYear: string;
    weekRange: string | null;
    weekStart: Date | null;
    weekEnd: Date | null;
    isMonthTotal: boolean;
    control: string | null;
  },
): PartidoRecord {
  const spec = Object.values(COLUMN_SPECS).find((s) => s.league === league)!;
  return {
    ...context,
    org: spec.org,
    league: spec.league,
    total: metrics.total ?? 0,
    tyc: metrics.tyc ?? null,
    directTv: metrics.directTv ?? null,
    bpEmitido: metrics.bpEmitido ?? 0,
    bpProducido: metrics.bpProducido ?? 0,
    externoProducido: metrics.externoProducido ?? 0,
  };
}

export function parseRows(rows: string[][]): PartidoRecord[] {
  const records: PartidoRecord[] = [];
  let currentSeason = "";
  let currentMonth = 0;
  let currentYear = 0;
  let currentMonthYear = "";

  for (let i = HEADER_ROW_COUNT; i < rows.length; i++) {
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
    const controlCell = (row[CONTROL_COL] ?? "").trim() || null;
    const isMonthTotal = weekCell.toLowerCase() === MONTH_TOTAL_LABEL.toLowerCase();

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

    const acc = buildLeagueAccumulator(row);
    for (const [league, metrics] of Object.entries(acc)) {
      if (!metrics.hasData) continue;
      records.push(
        makeRecord(league, metrics, {
          season: currentSeason,
          monthYear: currentMonthYear,
          weekRange,
          weekStart,
          weekEnd,
          isMonthTotal,
          control: controlCell,
        }),
      );
    }
  }

  return records;
}
