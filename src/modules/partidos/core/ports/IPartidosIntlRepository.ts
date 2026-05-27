import type { PartidoIntlProps } from '@partidos/core/entities/PartidoIntl';

export interface IPartidosIntlRepository {
  replaceAll(rows: PartidoIntlProps[]): Promise<number>;
  count(): Promise<number>;
}
