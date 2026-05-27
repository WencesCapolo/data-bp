export interface PartidosNacionalMonthlyPoint {
  monthYear: string;
  total: number;
  tyc: number;
  directTv: number;
  bpEmitido: number;
  bpProducido: number;
  externoProducido: number;
}

export interface PartidosIntlMonthlyPoint {
  monthYear: string;
  total: number;
  totalArg: number;
  totalFuera: number;
  bpEmitido: number;
  bpProducido: number;
  externoProducido: number;
}

export type PartidosNacionalMonthlyDTO = PartidosNacionalMonthlyPoint[];
export type PartidosIntlMonthlyDTO = PartidosIntlMonthlyPoint[];
