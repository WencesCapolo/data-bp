import { bucketize as bucketizeGeneric, type Bucket } from '@/lib/client/buckets';

export { BUCKETS, bucketLabel, fmtDay, type Bucket } from '@/lib/client/buckets';

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
  const r = bucketizeGeneric(
    days,
    { altas: series.altas, bajas: series.bajas },
    { active: series.active },
    b,
  );
  return {
    keys: r.keys,
    labels: r.labels,
    altas: r.flows.altas,
    bajas: r.flows.bajas,
    active: r.stocks.active,
  };
}
