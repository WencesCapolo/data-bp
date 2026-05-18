import type { IAnalyticsQueryRepository } from '@basket/core/ports/IAnalyticsQueryRepository';
import type { MetaDTO } from '@basket/core/dtos/MetaDTO';

export class GetMetaUseCase {
  constructor(private readonly repo: IAnalyticsQueryRepository) {}
  async execute(): Promise<MetaDTO> {
    return this.repo.getMeta();
  }
}
