import type { IPartidosNacionalQueryRepository } from '@partidos/core/ports/IPartidosNacionalQueryRepository';
import type { PartidosNacionalFilters } from '@partidos/core/dtos/shared';
import type { PartidosNacionalMonthlyDTO } from '@partidos/core/dtos/MonthlyDTO';

export class GetPartidosNacionalMonthlyUseCase {
  constructor(private readonly repo: IPartidosNacionalQueryRepository) {}
  execute(filters?: PartidosNacionalFilters): Promise<PartidosNacionalMonthlyDTO> {
    return this.repo.getMonthly(filters);
  }
}
