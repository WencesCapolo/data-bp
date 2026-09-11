import type { MatViewName } from '@basket/core/ports/IMaterializedViewRepository';

// Its own module, with no database import, so the order can be unit-tested.
/** Refresh order. A view is listed after every view it reads. */
export const ALL_VIEWS: readonly MatViewName[] = [
  // The Pagos fact table (migration 0021): basket_v_active_payments,
  // materialized. First, because basket_mat_period_windows reads it.
  'basket_mat_payment_facts',
  'basket_mat_daily_active',
  'basket_mat_monthly_lifecycle',
  'basket_mat_team_monthly',
  'basket_mat_team_daily',
  'basket_mat_revenue_daily',
  // Both read the fee mirror AND basket_v_active_payments (migration 0020), so
  // they belong after the Pagos-only views: a Pagos upload moves them too.
  'basket_mat_gateway_net_daily',
  'basket_mat_gateway_net_outside_pagos',
  'basket_mat_fixture_ranges',
  // The subscriber lifecycle /financiero draws, migration 0019. Off the Pagos
  // view like the first two, so they refresh after them for no reason but order.
  'basket_mat_subscriber_days',
  'basket_mat_subscriber_months',
  'basket_mat_subscription_last_charge',
  'basket_mat_subscriber_lifetime',
  // Economía's Sync-invariant figures, migration 0021. Coverage reads Pagos
  // and the fee mirror; the windows read the fact table above.
  'basket_mat_fee_coverage',
  'basket_mat_period_windows',
];

/** Re-analysed after every refresh: the planner otherwise works from the
 *  estimates of the last autovacuum, which on a table that is rewritten by
 *  bulk ingest and then read by 20 analytic queries per request may be never
 *  (last_analyze was NULL on every table of a dev copy). */
export const ANALYZED_TABLES = [
  'basket_payments',
  'basket_users',
  'basket_payment_fees',
  'basket_gateway_subscriptions',
] as const;
