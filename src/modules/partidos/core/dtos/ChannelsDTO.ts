export interface PartidosNacionalChannelsDTO {
  total: number;
  tyc: number;
  directTv: number;
  bpEmitido: number;
  bpProducido: number;
  externoProducido: number;
  byLeague: Array<{
    league: string;
    total: number;
    tyc: number;
    directTv: number;
    bpEmitido: number;
    bpProducido: number;
    externoProducido: number;
  }>;
}

export interface PartidosIntlChannelsDTO {
  total: number;
  totalArg: number;
  totalFuera: number;
  bpEmitido: number;
  bpProducido: number;
  externoProducido: number;
  byCountry: Array<{
    country: string;
    total: number;
    totalArg: number;
    totalFuera: number;
    bpEmitido: number;
    bpProducido: number;
    externoProducido: number;
  }>;
}
