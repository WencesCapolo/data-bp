import { InvalidWeekRangeError } from "../types";

export type WeekRange = { start: number; end: number };

export function parseWeekRange(raw: string): WeekRange {
  const cleaned = raw.replace(/\s+/g, "").trim();
  const match = cleaned.match(/^(\d{1,2})-(\d{1,2})$/);
  if (!match) throw new InvalidWeekRangeError(raw);
  const start = Number(match[1]);
  const end = Number(match[2]);
  if (start < 1 || end < start || end > 31) throw new InvalidWeekRangeError(raw);
  return { start, end };
}

export function weekRangeToDates(
  range: WeekRange,
  month: number,
  year: number,
): { weekStart: Date; weekEnd: Date } {
  const weekStart = new Date(Date.UTC(year, month - 1, range.start));
  const weekEnd = new Date(Date.UTC(year, month - 1, range.end));
  return { weekStart, weekEnd };
}
