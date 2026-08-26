import type { IAnalyticsQueryRepository } from '@basket/core/ports/IAnalyticsQueryRepository';
import type { ContenidoDTO } from '@basket/core/dtos/ContenidoDTO';

export class GetContenidoUseCase {
  constructor(private readonly repo: IAnalyticsQueryRepository) {}
  async execute(opts: {
    from?: string;
    to?: string;
    country?: string;
  }): Promise<ContenidoDTO> {
    return this.repo.getContenido(opts);
  }
}
