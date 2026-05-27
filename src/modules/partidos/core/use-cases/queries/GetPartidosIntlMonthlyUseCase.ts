import type { IPartidosIntlQueryRepository } from '@partidos/core/ports/IPartidosIntlQueryRepository';
import type { PartidosIntlFilters } from '@partidos/core/dtos/shared';
import type { PartidosIntlMonthlyDTO } from '@partidos/core/dtos/MonthlyDTO';

export class GetPartidosIntlMonthlyUseCase {
  constructor(private readonly repo: IPartidosIntlQueryRepository) {}
  execute(filters?: PartidosIntlFilters): Promise<PartidosIntlMonthlyDTO> {
    return this.repo.getMonthly(filters);
  }
}
