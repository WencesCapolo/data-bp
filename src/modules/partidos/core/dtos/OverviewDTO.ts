export interface PartidosNacionalOverviewDTO {
  totalSeason: number;
  totalMonth: number;
  totalWeek: number;
  avgWeek: number;
  deltaMonth: number | null;
  deltaWeek: number | null;
  lastMonthLabel: string | null;
  lastWeekLabel: string | null;
}

export interface PartidosIntlOverviewDTO {
  totalSeason: number;
  totalMonth: number;
  totalArg: number;
  totalFuera: number;
  bpEmitido: number;
  bpProducido: number;
  externoProducido: number;
  lastMonthLabel: string | null;
}
