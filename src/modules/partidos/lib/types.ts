import type { Country, IntlLeague, League, Org } from "./constants";

export type { Country, IntlLeague };

export type Metric =
  | "total"
  | "tyc"
  | "directTv"
  | "bpEmitido"
  | "bpProducido"
  | "externoProducido";

export type ColumnSpec = {
  league: League;
  org: Org;
  metric: Metric;
};

export type PartidoRecord = {
  season: string;
  monthYear: string;
  weekRange: string | null;
  weekStart: Date | null;
  weekEnd: Date | null;
  isMonthTotal: boolean;
  control: string | null;
  org: Org;
  league: League;
  total: number;
  tyc: number | null;
  directTv: number | null;
  bpEmitido: number;
  bpProducido: number;
  externoProducido: number;
};

export type IntlMetric =
  | "total"
  | "totalArg"
  | "totalFuera"
  | "bpEmitido"
  | "bpProducido"
  | "externoProducido"
  | "sinTv"
  | "tvUruguay"
  | "senalCompleta"
  | "offtube"
  | "envioSenalCompleta"
  | "recibidosAtm"
  | "enviadosSportian"
  | "emitidosCdo"
  | "enviosSynergy"
  | "emitidosTvn";

export type IntlColumnSpec = {
  country: Country;
  league: IntlLeague;
  metric: IntlMetric;
};

export type PartidoIntlRecord = {
  season: string;
  monthYear: string;
  weekRange: string | null;
  weekStart: Date | null;
  weekEnd: Date | null;
  isMonthTotal: boolean;
  country: Country;
  league: IntlLeague;
  total: number;
  totalArg: number | null;
  totalFuera: number | null;
  bpEmitido: number;
  bpProducido: number;
  externoProducido: number;
  granular: {
    sinTv?: number;
    tvUruguay?: number;
    senalCompleta?: number;
    offtube?: number;
    envioSenalCompleta?: number;
    recibidosAtm?: number;
    enviadosSportian?: number;
    emitidosCdo?: number;
    enviosSynergy?: number;
    emitidosTvn?: number;
  };
};

export class InvalidWeekRangeError extends Error {
  constructor(raw: string) {
    super(`Invalid week range: "${raw}"`);
    this.name = "InvalidWeekRangeError";
  }
}

export class InvalidMonthNameError extends Error {
  constructor(raw: string) {
    super(`Invalid month name: "${raw}"`);
    this.name = "InvalidMonthNameError";
  }
}
