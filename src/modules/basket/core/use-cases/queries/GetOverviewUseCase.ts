import type { IAnalyticsQueryRepository } from '@basket/core/ports/IAnalyticsQueryRepository';
import type { OverviewDTO } from '@basket/core/dtos/OverviewDTO';

export class GetOverviewUseCase {
  constructor(private readonly repo: IAnalyticsQueryRepository) {}
  async execute(asOf?: Date): Promise<OverviewDTO> {
    return this.repo.getOverview(asOf);
  }
}
