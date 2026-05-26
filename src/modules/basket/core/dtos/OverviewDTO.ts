export interface OverviewKpis {
  activeAll: number;
  activeReal: number;
  activeVoucher: number;
  activeAntel: number;
  activeFree: number;
  activeMensualBasico: number;
  activeMensualTotal: number;
  activeAnualTotal: number;
  newPayersInRange: number;
  revenueInRangeByCurrency: { currency: string; amount: number }[];
}

export interface OverviewTrendPoint {
  day: string; // ISO date
  allActive: number;
  realActive: number;
  voucherActive: number;
}

export interface OverviewBreakdown {
  label: string;
  count: number;
  pct: number;
}

export interface OverviewDTO {
  asOf: string;
  kpis: OverviewKpis;
  trend: OverviewTrendPoint[];
  accessBreakdown: OverviewBreakdown[];
  subTypeBreakdown: OverviewBreakdown[];
  countryBreakdown: OverviewBreakdown[];
}
