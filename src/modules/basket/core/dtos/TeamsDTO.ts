import type { DateRange } from './shared';

export interface TeamRankRow {
  teamId: number;
  teamName: string;
  league: string;
  teamCountry: string;
  uniquePayers: number;
  totalPayments: number;
  totalAmount: number;
  realPayers: number;
  voucherPayers: number;
}

export interface TeamTrendPoint {
  month: string;
  uniquePayers: number;
  totalAmount: number;
}

export interface TeamsDTO {
  range: DateRange;
  totals: {
    teams: number;
    uniquePayers: number;
    totalPayments: number;
  };
  ranked: TeamRankRow[];
}

export interface TeamTrendDTO {
  teamId: number;
  teamName: string;
  points: TeamTrendPoint[];
}
