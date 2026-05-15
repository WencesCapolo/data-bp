import type { IAnalyticsQueryRepository } from '@basket/core/ports/IAnalyticsQueryRepository';
import type { RetentionDTO } from '@basket/core/dtos/RetentionDTO';

export class GetRetentionUseCase {
  constructor(private readonly repo: IAnalyticsQueryRepository) {}
  async execute(): Promise<RetentionDTO> {
    return this.repo.getRetention();
  }
}
