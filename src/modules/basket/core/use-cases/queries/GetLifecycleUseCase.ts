import type { IAnalyticsQueryRepository } from '@basket/core/ports/IAnalyticsQueryRepository';
import type { CommonFilters, DateRange } from '@basket/core/dtos/shared';
import type { LifecycleDTO } from '@basket/core/dtos/LifecycleDTO';

export class GetLifecycleUseCase {
  constructor(private readonly repo: IAnalyticsQueryRepository) {}
  async execute(range: DateRange, filters?: CommonFilters): Promise<LifecycleDTO> {
    return this.repo.getLifecycle(range, filters);
  }
}
