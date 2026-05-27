import type { IPartidosNacionalQueryRepository } from '@partidos/core/ports/IPartidosNacionalQueryRepository';
import type { PartidosNacionalMetaDTO } from '@partidos/core/dtos/MetaDTO';

export class GetPartidosNacionalMetaUseCase {
  constructor(private readonly repo: IPartidosNacionalQueryRepository) {}
  execute(): Promise<PartidosNacionalMetaDTO> {
    return this.repo.getMeta();
  }
}
