import type { Granularity } from '@basket/core/dtos/shared';

// One row per closed bucket. `bucket` is the ISO date the bucket starts on:
// the 1st for months, the Monday for weeks, the day itself for days.
export interface LifecycleBucketRow {
  bucket: string;
  activeStart: number;
  activeEnd: number;
  newPayers: number;
  renewals: number;
  reactivations: number;
  expirations: number;
  churnRatePct: number;
  retentionRatePct: number;
}

export interface RetentionDTO {
  granularity: Granularity;
  rows: LifecycleBucketRow[];
  latestChurnRatePct: number | null;
  latestRetentionRatePct: number | null;
}
