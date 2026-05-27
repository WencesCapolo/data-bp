import { SPANISH_MONTHS } from "../constants";
import { InvalidMonthNameError } from "../types";

export function parseMonthCell(raw: string): { month: number; year: number } {
  const cleaned = raw.replace(/\s+/g, " ").trim();
  const match = cleaned.match(/^([A-Za-zÁÉÍÓÚáéíóú]+)\s+(\d{4})$/);
  if (!match) throw new InvalidMonthNameError(raw);
  const monthKey = match[1].toLowerCase();
  const month = SPANISH_MONTHS[monthKey];
  if (!month) throw new InvalidMonthNameError(raw);
  return { month, year: Number(match[2]) };
}

export function toMonthYear(month: number, year: number): string {
  return `${year}-${String(month).padStart(2, "0")}`;
}
