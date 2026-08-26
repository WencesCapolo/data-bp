// The Economía tab of /financiero: gross revenue as our own Pagos record it,
// net revenue as the gateway reports it, and the price book behind both.
//
// There is no single revenue number anywhere in here. Nothing converts UYU, ARS
// or CLP into USD yet (`basket_fx_rates` is unbuilt — phase 3 of
// docs/handoff/financiero-dashboard-port.md), so every money figure carries the
// currency it is denominated in and figures in different currencies are never
// added. When the FX plane lands, a converted total becomes a new field, not a
// reinterpretation of these.
import type { DateRange } from './shared';
import type { GatewayNetDTO } from './GatewayNetDTO';

/** Gross, presentment plane: what subscribers were charged, per our own Pagos. */
export interface MonthlyGrossPoint {
  month: string;
  currency: string;
  platformName: string;
  gross: number;
  txCount: number;
}

/** Gross by country of the subscriber, presentment plane. */
export interface CountryRevenueRow {
  country: string;
  currency: string;
  gross: number;
  txCount: number;
  payers: number;
}

/**
 * The price book as the payments actually exercised it — plan × market ×
 * currency × price, with how many Pagos landed on each point. `season` buckets
 * by sporting season (Sep→Aug), the way the prototype's catálogo does.
 */
export interface PlanCatalogRow {
  planFamily: string;
  planFrequency: string;
  market: string;
  currency: string;
  season: string;
  price: number;
  txCount: number;
}

/** One row per month per currency: the table under "Detalle mensual". */
export interface MonthlyDetailRow {
  month: string;
  currency: string;
  gross: number;
  txCount: number;
  payers: number;
}

export interface EconomiaDTO {
  range: DateRange;
  /**
   * Gateways whose gross we can show but whose fees we cannot, so the tab can
   * say which platforms are missing from every net figure instead of implying
   * they cost nothing. MercadoPago (credentials blocked) and PayPal (no fee
   * feed) live here today.
   */
  grossOnlyPlatforms: string[];
  monthlyGross: MonthlyGrossPoint[];
  byCountry: CountryRevenueRow[];
  catalog: PlanCatalogRow[];
  monthlyDetail: MonthlyDetailRow[];
  /** Net, fees, refunds and subscription churn. Stripe only — see the seam. */
  gateway: GatewayNetDTO;
}
