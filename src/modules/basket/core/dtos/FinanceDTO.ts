import type { DateRange } from './shared';

export interface RevenueDailyPoint {
  day: string;
  currency: string;
  totalAmount: number;
  realAmount: number;
  paymentCount: number;
}

export interface PlatformBreakdownRow {
  platform: number;
  platformName: string;
  paymentCount: number;
  totalAmount: number;
  realCount: number;
  realAmount: number;
}

export interface CurrencyTotal {
  currency: string;
  totalAmount: number;
  paymentCount: number;
}

export interface PlatformMonthlyPoint {
  month: string;
  platformName: string;
  totalAmount: number;
}

export interface FinanceDTO {
  range: DateRange;
  revenueByDay: RevenueDailyPoint[];
  byPlatform: PlatformBreakdownRow[];
  byCurrency: CurrencyTotal[];
  platformMonthly: PlatformMonthlyPoint[];
}
