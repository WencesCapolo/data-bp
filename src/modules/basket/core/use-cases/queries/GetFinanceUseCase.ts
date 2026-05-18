import type { IAnalyticsQueryRepository } from '@basket/core/ports/IAnalyticsQueryRepository';
import type { CommonFilters, DateRange } from '@basket/core/dtos/shared';
import type { FinanceDTO } from '@basket/core/dtos/FinanceDTO';

export class GetFinanceUseCase {
  constructor(private readonly repo: IAnalyticsQueryRepository) {}
  async execute(range: DateRange, filters?: CommonFilters): Promise<FinanceDTO> {
    return this.repo.getFinance(range, filters);
  }
}
