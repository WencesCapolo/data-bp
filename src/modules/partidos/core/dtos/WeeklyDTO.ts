export interface PartidosNacionalWeeklyPoint {
  weekStart: string;
  monthYear: string;
  weekRange: string;
  total: number;
  tyc: number;
  directTv: number;
  bpEmitido: number;
  bpProducido: number;
  externoProducido: number;
}

export interface PartidosIntlWeeklyPoint {
  weekStart: string;
  monthYear: string;
  weekRange: string;
  total: number;
  totalArg: number;
  totalFuera: number;
  bpEmitido: number;
  bpProducido: number;
  externoProducido: number;
}

export type PartidosNacionalWeeklyDTO = PartidosNacionalWeeklyPoint[];
export type PartidosIntlWeeklyDTO = PartidosIntlWeeklyPoint[];
