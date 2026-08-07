// Chart x-axis labels are abbreviated to stay legible ('08/05', 'ago 26'), which
// hides both the year and the span a bucket covers. Tooltips get the full story:
// always dd/mm/yyyy, and the closing day too when the bucket is wider than a day.

export type BucketUnit = 'day' | 'week' | 'month' | 'year';

const UNIT_LABEL: Record<BucketUnit, string> = {
  day: 'Día',
  week: 'Semana',
  month: 'Mes',
  year: 'Año',
};

// Accepts the shapes the API emits: 'YYYY-MM-DD' (day, week start, month start),
// 'YYYY-MM' (month) and 'YYYY' (year).
function startOf(key: string): Date | null {
  const iso =
    key.length === 4 ? `${key}-01-01` : key.length === 7 ? `${key}-01` : key.slice(0, 10);
  const d = new Date(`${iso}T00:00:00Z`);
  return Number.isNaN(d.getTime()) ? null : d;
}

function endOf(start: Date, unit: BucketUnit): Date {
  const d = new Date(start);
  if (unit === 'day') return d;
  if (unit === 'week') d.setUTCDate(d.getUTCDate() + 6);
  else if (unit === 'month') d.setUTCMonth(d.getUTCMonth() + 1, 0);
  else d.setUTCFullYear(d.getUTCFullYear() + 1, 0, 0);
  return d;
}

export function fmtDMY(d: Date): string {
  const p = (n: number) => String(n).padStart(2, '0');
  return `${p(d.getUTCDate())}/${p(d.getUTCMonth() + 1)}/${d.getUTCFullYear()}`;
}

export function bucketTitle(key: string, unit: BucketUnit): string {
  const start = startOf(key);
  if (!start) return key;
  const end = endOf(start, unit);
  const span =
    unit === 'day' ? fmtDMY(start) : `${fmtDMY(start)} → ${fmtDMY(end)}`;
  return `${UNIT_LABEL[unit]} · ${span}`;
}

export function bucketTitles(keys: string[], unit: BucketUnit): string[] {
  return keys.map((k) => bucketTitle(k, unit));
}
