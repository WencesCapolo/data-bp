import type { IPartidosIntlQueryRepository } from '@partidos/core/ports/IPartidosIntlQueryRepository';
import type { PartidosIntlFilters } from '@partidos/core/dtos/shared';
import type { PartidosIntlWeeklyDTO } from '@partidos/core/dtos/WeeklyDTO';

export class GetPartidosIntlWeeklyUseCase {
  constructor(private readonly repo: IPartidosIntlQueryRepository) {}
  execute(filters?: PartidosIntlFilters): Promise<PartidosIntlWeeklyDTO> {
    return this.repo.getWeekly(filters);
  }
}
