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

export interface BucketedSeries {
  keys: string[];
  labels: string[];
  altas: number[];
  bajas: number[];
  active: number[];
}

// Altas/bajas are flows — they add up inside a bucket. Active subscriptions are a
// stock, so a bucket takes its last day's value, not a sum.
export function bucketize(
  days: string[],
  series: { altas: number[]; bajas: number[]; active: number[] },
  b: Bucket,
): BucketedSeries {
  const keys: string[] = [];
  const altas: number[] = [];
  const bajas: number[] = [];
  const active: number[] = [];
  days.forEach((iso, i) => {
    const key = bucketKey(iso, b);
    if (keys[keys.length - 1] !== key) {
      keys.push(key);
      altas.push(0);
      bajas.push(0);
      active.push(0);
    }
    const j = keys.length - 1;
    altas[j] += series.altas[i] ?? 0;
    bajas[j] += series.bajas[i] ?? 0;
    active[j] = series.active[i] ?? 0;
  });
  return { keys, labels: keys.map((k) => bucketLabel(k, b)), altas, bajas, active };
}
