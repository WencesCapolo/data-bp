import { DrizzleAnalyticsQueryRepository } from '@basket/infrastructure/db/repositories/DrizzleAnalyticsQueryRepository';

let cached: DrizzleAnalyticsQueryRepository | null = null;

export function composeRepo(): DrizzleAnalyticsQueryRepository {
  if (!cached) cached = new DrizzleAnalyticsQueryRepository();
  return cached;
}
