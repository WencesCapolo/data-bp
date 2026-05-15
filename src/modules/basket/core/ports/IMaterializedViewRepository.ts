export type MatViewName =
  | 'basket_mat_daily_active'
  | 'basket_mat_monthly_lifecycle'
  | 'basket_mat_team_monthly'
  | 'basket_mat_revenue_daily';

export interface RefreshResult {
  view: MatViewName;
  durationMs: number;
  rowCount: number;
}

export interface IMaterializedViewRepository {
  refresh(view: MatViewName, concurrent: boolean): Promise<RefreshResult>;
  refreshAll(concurrent: boolean): Promise<RefreshResult[]>;
}
