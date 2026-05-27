import { DrizzlePartidosNacionalQueryRepository } from '@partidos/infrastructure/db/repositories/DrizzlePartidosNacionalQueryRepository';
import { DrizzlePartidosIntlQueryRepository } from '@partidos/infrastructure/db/repositories/DrizzlePartidosIntlQueryRepository';

let nacional: DrizzlePartidosNacionalQueryRepository | null = null;
let intl: DrizzlePartidosIntlQueryRepository | null = null;

export function composePartidosNacionalRepo(): DrizzlePartidosNacionalQueryRepository {
  if (!nacional) nacional = new DrizzlePartidosNacionalQueryRepository();
  return nacional;
}

export function composePartidosIntlRepo(): DrizzlePartidosIntlQueryRepository {
  if (!intl) intl = new DrizzlePartidosIntlQueryRepository();
  return intl;
}
