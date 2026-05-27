import type { IPartidosNacionalQueryRepository } from '@partidos/core/ports/IPartidosNacionalQueryRepository';
import type { PartidosNacionalFilters } from '@partidos/core/dtos/shared';
import type { PartidosNacionalChannelsDTO } from '@partidos/core/dtos/ChannelsDTO';

export class GetPartidosNacionalChannelsUseCase {
  constructor(private readonly repo: IPartidosNacionalQueryRepository) {}
  execute(filters?: PartidosNacionalFilters): Promise<PartidosNacionalChannelsDTO> {
    return this.repo.getChannels(filters);
  }
}
