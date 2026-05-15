import type { IAnalyticsQueryRepository } from '@basket/core/ports/IAnalyticsQueryRepository';
import type { DataQualityDTO } from '@basket/core/dtos/DataQualityDTO';

export class GetDataQualityUseCase {
  constructor(private readonly repo: IAnalyticsQueryRepository) {}
  async execute(): Promise<DataQualityDTO> {
    return this.repo.getDataQuality();
  }
}
