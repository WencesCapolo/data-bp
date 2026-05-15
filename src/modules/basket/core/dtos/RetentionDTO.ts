export interface LifecycleMonthRow {
  month: string;
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
  rows: LifecycleMonthRow[];
  latestChurnRatePct: number | null;
  latestRetentionRatePct: number | null;
}
