/**
 * One day's exchange rate, from one named source.
 *
 * `rate` is quote units per one base unit and the pair is read off the row, not
 * guessed from the magnitude: `(USD, ARS, 'blue', 1565)` says 1,565 ARS buys one
 * USD, and `(UYU, USD, 'stripe', 0.0256)` says one UYU settled as 0.0256 USD.
 * An amount denominated in `baseCurrency` is multiplied by the rate; one
 * denominated in `quoteCurrency` is divided by it.
 *
 * The source is part of the identity, not a label. Two rates for the same day
 * are both correct and they disagree — see docs/adr/0007.
 */
export interface FxRateProps {
  /** Calendar day, YYYY-MM-DD. A date, not a timestamp: a rate is a day's rate. */
  day: string;
  baseCurrency: string;
  quoteCurrency: string;
  /** 'blue' (dolarapi, fetched) | 'stripe' (derived from the fee mirror). */
  source: string;
  rate: number;
  /** The compra side, where the source quotes two. Never converted with. */
  buyRate: number | null;
}

/** Which way an amount crosses a rate. Named so a call site cannot swap them. */
export type FxDirection = 'baseToQuote' | 'quoteToBase';

export class FxRate {
  constructor(private readonly props: FxRateProps) {}

  get day(): string { return this.props.day; }
  get source(): string { return this.props.source; }

  /** `USD→ARS`, printable next to any converted figure. */
  get pair(): string {
    return `${this.props.baseCurrency}→${this.props.quoteCurrency}`;
  }

  convert(amount: number, direction: FxDirection): number {
    if (this.props.rate <= 0) {
      throw new Error(`fx rate for ${this.pair} on ${this.props.day} is not positive`);
    }
    return direction === 'baseToQuote' ? amount * this.props.rate : amount / this.props.rate;
  }

  toJSON(): FxRateProps { return { ...this.props }; }

  static fromProps(props: FxRateProps): FxRate { return new FxRate(props); }
}
