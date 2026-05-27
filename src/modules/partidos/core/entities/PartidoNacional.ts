import type { League, Org } from '../value-objects/leagues';

export interface PartidoNacionalProps {
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
}

export class PartidoNacional {
  constructor(private readonly props: PartidoNacionalProps) {}

  get props_(): PartidoNacionalProps {
    return this.props;
  }

  static fromProps(props: PartidoNacionalProps): PartidoNacional {
    return new PartidoNacional(props);
  }
}
