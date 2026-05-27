import type { IPartidosNacionalQueryRepository } from '@partidos/core/ports/IPartidosNacionalQueryRepository';
import type { PartidosNacionalFilters } from '@partidos/core/dtos/shared';
import type { PartidosNacionalWeeklyDTO } from '@partidos/core/dtos/WeeklyDTO';

export class GetPartidosNacionalWeeklyUseCase {
  constructor(private readonly repo: IPartidosNacionalQueryRepository) {}
  execute(filters?: PartidosNacionalFilters): Promise<PartidosNacionalWeeklyDTO> {
    return this.repo.getWeekly(filters);
  }
}
