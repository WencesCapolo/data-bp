import type { IAnalyticsQueryRepository } from '@basket/core/ports/IAnalyticsQueryRepository';
import type { CommonFilters, DateRange } from '@basket/core/dtos/shared';
import type { EconomiaDTO } from '@basket/core/dtos/EconomiaDTO';

export class GetEconomiaUseCase {
  constructor(private readonly repo: IAnalyticsQueryRepository) {}
  async execute(range: DateRange, filters?: CommonFilters): Promise<EconomiaDTO> {
    return this.repo.getEconomia(range, filters);
  }
}
