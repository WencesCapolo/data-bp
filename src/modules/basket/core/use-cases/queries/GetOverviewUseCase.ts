import type { IAnalyticsQueryRepository } from '@basket/core/ports/IAnalyticsQueryRepository';
import type { CommonFilters } from '@basket/core/dtos/shared';
import type { OverviewDTO } from '@basket/core/dtos/OverviewDTO';

export class GetOverviewUseCase {
  constructor(private readonly repo: IAnalyticsQueryRepository) {}
  async execute(asOf?: Date, filters?: CommonFilters): Promise<OverviewDTO> {
    return this.repo.getOverview(asOf, filters);
  }
}
