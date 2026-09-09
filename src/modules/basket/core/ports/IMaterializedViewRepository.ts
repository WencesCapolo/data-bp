export type MatViewName =
  | 'basket_mat_daily_active'
  | 'basket_mat_monthly_lifecycle'
  | 'basket_mat_team_monthly'
  | 'basket_mat_team_daily'
  | 'basket_mat_revenue_daily'
  | 'basket_mat_gateway_net_daily'
  | 'basket_mat_gateway_net_outside_pagos'
  | 'basket_mat_fixture_ranges'
  | 'basket_mat_subscriber_days'
  | 'basket_mat_subscriber_months'
  | 'basket_mat_subscription_last_charge'
  | 'basket_mat_subscriber_lifetime';

export interface RefreshResult {
  view: MatViewName;
  durationMs: number;
  rowCount: number;
}

export interface IMaterializedViewRepository {
  refresh(view: MatViewName, concurrent: boolean): Promise<RefreshResult>;
  refreshAll(concurrent: boolean): Promise<RefreshResult[]>;
}
