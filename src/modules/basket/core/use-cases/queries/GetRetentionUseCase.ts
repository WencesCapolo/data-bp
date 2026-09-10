import type { IAnalyticsQueryRepository } from '@basket/core/ports/IAnalyticsQueryRepository';
import type { RetentionDTO } from '@basket/core/dtos/RetentionDTO';
import type { CommonFilters, DateRange, Granularity } from '@basket/core/dtos/shared';

export class GetRetentionUseCase {
  constructor(private readonly repo: IAnalyticsQueryRepository) {}
  async execute(
    range?: DateRange,
    filters?: CommonFilters,
    granularity: Granularity = 'month',
  ): Promise<RetentionDTO> {
    return this.repo.getRetention(range, filters, granularity);
  }
}
