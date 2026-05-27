import type { Country, IntlLeague } from '../value-objects/leagues';

export interface PartidoIntlGranular {
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
}

export interface PartidoIntlProps {
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
  granular: PartidoIntlGranular;
}

export class PartidoIntl {
  constructor(private readonly props: PartidoIntlProps) {}

  get props_(): PartidoIntlProps {
    return this.props;
  }

  static fromProps(props: PartidoIntlProps): PartidoIntl {
    return new PartidoIntl(props);
  }
}
