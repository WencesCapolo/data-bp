// Client-side bucketing of a dense daily series. The API always answers by day;
// day/week/month/year is a view choice, so folding it here keeps one definition
// of a bucket boundary for every tab that offers the selector.

export type Bucket = 'day' | 'week' | 'month' | 'year';

export const BUCKETS: { key: Bucket; label: string }[] = [
  { key: 'day', label: 'Día' },
  { key: 'week', label: 'Semana' },
  { key: 'month', label: 'Mes' },
  { key: 'year', label: 'Año' },
];

const MONTHS = ['ene', 'feb', 'mar', 'abr', 'may', 'jun', 'jul', 'ago', 'sep', 'oct', 'nov', 'dic'];

export const fmtDay = (d: string): string => d.slice(5).replace('-', '/');

function bucketKey(iso: string, b: Bucket): string {
  if (b === 'day') return iso;
  if (b === 'year') return iso.slice(0, 4);
  if (b === 'month') return iso.slice(0, 7);
  const d = new Date(`${iso}T00:00:00Z`);
  const dow = (d.getUTCDay() + 6) % 7; // Monday = 0
  d.setUTCDate(d.getUTCDate() - dow);
  return d.toISOString().slice(0, 10);
}

export function bucketLabel(key: string, b: Bucket): string {
  if (b === 'year') return key;
  if (b === 'month') return `${MONTHS[Number(key.slice(5, 7)) - 1]} ${key.slice(2, 4)}`;
  if (b === 'week') return `sem ${fmtDay(key)}`;
  return fmtDay(key);
}

export interface Bucketed<F extends string, S extends string> {
  keys: string[];
  labels: string[];
  flows: Record<F, number[]>;
  stocks: Record<S, number[]>;
}

// Flows are events — they add up inside a bucket. Stocks are levels, so a
// bucket takes its last day's value, not a sum.
export function bucketize<F extends string, S extends string>(
  days: string[],
  flows: Record<F, number[]>,
  stocks: Record<S, number[]>,
  b: Bucket,
): Bucketed<F, S> {
  const flowKeys = Object.keys(flows) as F[];
  const stockKeys = Object.keys(stocks) as S[];
  const keys: string[] = [];
  const outFlows = Object.fromEntries(flowKeys.map((k) => [k, [] as number[]])) as Record<F, number[]>;
  const outStocks = Object.fromEntries(stockKeys.map((k) => [k, [] as number[]])) as Record<S, number[]>;

  days.forEach((iso, i) => {
    const key = bucketKey(iso, b);
    if (keys[keys.length - 1] !== key) {
      keys.push(key);
      for (const k of flowKeys) outFlows[k].push(0);
      for (const k of stockKeys) outStocks[k].push(0);
    }
    const j = keys.length - 1;
    for (const k of flowKeys) outFlows[k][j] += flows[k][i] ?? 0;
    for (const k of stockKeys) outStocks[k][j] = stocks[k][i] ?? 0;
  });

  return { keys, labels: keys.map((k) => bucketLabel(k, b)), flows: outFlows, stocks: outStocks };
}
