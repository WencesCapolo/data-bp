import type { DateRange, Granularity } from './shared';

export interface EvolutionPoint {
  bucket: string; // ISO date (start of day/week/month)
  allActive: number;
  realActive: number;
  voucherActive: number;
  freeActive: number;
  mensualBasicoActive: number;
  mensualTotalActive: number;
  anualTotalActive: number;
}

export interface EvolutionDTO {
  range: DateRange;
  granularity: Granularity;
  series: EvolutionPoint[];
}
