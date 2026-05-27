import type { IPartidosIntlQueryRepository } from '@partidos/core/ports/IPartidosIntlQueryRepository';
import type { PartidosIntlMetaDTO } from '@partidos/core/dtos/MetaDTO';

export class GetPartidosIntlMetaUseCase {
  constructor(private readonly repo: IPartidosIntlQueryRepository) {}
  execute(): Promise<PartidosIntlMetaDTO> {
    return this.repo.getMeta();
  }
}
