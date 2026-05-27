import type { PartidoNacionalProps } from '@partidos/core/entities/PartidoNacional';

export interface IPartidosNacionalRepository {
  replaceAll(rows: PartidoNacionalProps[]): Promise<number>;
  count(): Promise<number>;
}
