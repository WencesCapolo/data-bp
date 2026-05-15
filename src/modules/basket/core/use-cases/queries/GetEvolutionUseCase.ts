import type { IAnalyticsQueryRepository } from '@basket/core/ports/IAnalyticsQueryRepository';
import type { DateRange, Granularity } from '@basket/core/dtos/shared';
import type { EvolutionDTO } from '@basket/core/dtos/EvolutionDTO';

export class GetEvolutionUseCase {
  constructor(private readonly repo: IAnalyticsQueryRepository) {}
  async execute(range: DateRange, granularity: Granularity = 'day'): Promise<EvolutionDTO> {
    return this.repo.getEvolution(range, granularity);
  }
}
