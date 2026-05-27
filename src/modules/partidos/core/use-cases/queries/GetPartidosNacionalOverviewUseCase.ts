import type { IPartidosNacionalQueryRepository } from '@partidos/core/ports/IPartidosNacionalQueryRepository';
import type { PartidosNacionalFilters } from '@partidos/core/dtos/shared';
import type { PartidosNacionalOverviewDTO } from '@partidos/core/dtos/OverviewDTO';

export class GetPartidosNacionalOverviewUseCase {
  constructor(private readonly repo: IPartidosNacionalQueryRepository) {}
  execute(filters?: PartidosNacionalFilters): Promise<PartidosNacionalOverviewDTO> {
    return this.repo.getOverview(filters);
  }
}
