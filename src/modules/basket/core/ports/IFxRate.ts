import type { FxRateProps } from '@basket/core/entities/FxRate';

/**
 * A source of daily rates.
 *
 * Deliberately not the `GatewayWindowSource` / `GatewayFullSource` pair the
 * Provider mirrors use. A rate feed has neither shape: the history endpoint
 * answers with all five thousand days at once and cannot be windowed at all, and
 * a rate is not a Provider object, so it has no `platform`. Modelling it as a
 * gateway mirror would have meant inventing a platform number for dolarapi.
 */
export interface IFxRateSource {
  /** Short slug, and the value written to basket_fx_rates.source: 'blue'. */
  readonly source: string;
  /** The pair this source quotes, so a caller can report it without fetching. */
  readonly baseCurrency: string;
  readonly quoteCurrency: string;
  /**
   * Every day the source has, oldest first. `since` is a floor, not a window:
   * a source that can only answer whole is free to ignore it, and the caller
   * filters. Sources that quote one day only yield one row.
   */
  fetch(since?: string): Promise<FxRateProps[]>;
}

/** A day with no rate, so a caller can say *which* days are absent. */
export interface FxGap {
  source: string;
  baseCurrency: string;
  quoteCurrency: string;
  day: string;
}

export interface FxCoverage {
  source: string;
  baseCurrency: string;
  quoteCurrency: string;
  days: number;
  firstDay: string | null;
  lastDay: string | null;
}

export interface IFxRateRepository {
  upsertMany(rates: FxRateProps[]): Promise<number>;
  count(): Promise<number>;
  coverage(): Promise<FxCoverage[]>;
  /**
   * Calendar days between `from` and `to` that this pair+source has no row for.
   * The blue history carries every day including weekends, so a gap is a broken
   * feed rather than a closed market — which is why this returns the days
   * themselves and not a count.
   */
  gaps(source: string, base: string, quote: string, from: string, to: string): Promise<string[]>;
  /**
   * Rebuilds the derived 'stripe' rows from basket_payment_fees: per day and
   * presentment currency, the volume-weighted rate Stripe actually applied.
   * Returns the rows written. Derived, so it is safe to run whenever the fee
   * mirror moves, and it never invents a day the mirror has no charges on.
   */
  refreshDerivedStripeRates(): Promise<number>;
}
