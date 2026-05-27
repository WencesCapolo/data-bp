import type { IPartidosIntlQueryRepository } from '@partidos/core/ports/IPartidosIntlQueryRepository';
import type { PartidosIntlFilters } from '@partidos/core/dtos/shared';
import type { PartidosIntlOverviewDTO } from '@partidos/core/dtos/OverviewDTO';

export class GetPartidosIntlOverviewUseCase {
  constructor(private readonly repo: IPartidosIntlQueryRepository) {}
  execute(filters?: PartidosIntlFilters): Promise<PartidosIntlOverviewDTO> {
    return this.repo.getOverview(filters);
  }
}
