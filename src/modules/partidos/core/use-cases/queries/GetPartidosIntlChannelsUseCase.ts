import type { IPartidosIntlQueryRepository } from '@partidos/core/ports/IPartidosIntlQueryRepository';
import type { PartidosIntlFilters } from '@partidos/core/dtos/shared';
import type { PartidosIntlChannelsDTO } from '@partidos/core/dtos/ChannelsDTO';

export class GetPartidosIntlChannelsUseCase {
  constructor(private readonly repo: IPartidosIntlQueryRepository) {}
  execute(filters?: PartidosIntlFilters): Promise<PartidosIntlChannelsDTO> {
    return this.repo.getChannels(filters);
  }
}
