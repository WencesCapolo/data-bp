/**
 * Stripe quotes every amount in the currency's smallest unit. The divisor is not
 * always 100: CLP — one of our real currencies, 33k Pagos — is zero-decimal, so
 * dividing by 100 would report Chilean revenue at 1% of its true value. The
 * three-decimal currencies are here for completeness; none are in use today.
 *
 * https://docs.stripe.com/currencies#zero-decimal
 */
const ZERO_DECIMAL = new Set([
  'bif', 'clp', 'djf', 'gnf', 'jpy', 'kmf', 'krw', 'mga',
  'pyg', 'rwf', 'ugx', 'vnd', 'vuv', 'xaf', 'xof', 'xpf',
]);

const THREE_DECIMAL = new Set(['bhd', 'jod', 'kwd', 'omr', 'tnd']);

export function minorUnitDivisor(currency: string): number {
  const c = currency.toLowerCase();
  if (ZERO_DECIMAL.has(c)) return 1;
  if (THREE_DECIMAL.has(c)) return 1000;
  return 100;
}

/** Stripe minor units → major units, rounded to the 2 decimals the column holds. */
export function fromMinorUnits(amount: number, currency: string): number {
  return round2(amount / minorUnitDivisor(currency));
}

export function round2(value: number): number {
  return Math.round(value * 100) / 100;
}

/**
 * Stripe's `exchange_rate` is minor units per minor unit, not major per major.
 *
 * For UYU→USD the two are the same number and nothing notices. For CLP→USD they
 * differ by exactly 100×, because CLP is zero-decimal: 1,000 CLP is 1,000 minor
 * units, and `1000 * 0.1017` is 101.7 minor units of USD — $1.017, not $101.70.
 * Multiplying our major-unit `gross_amount` by the stored rate therefore
 * overstated every Chilean transaction a hundredfold, and only Chilean ones, so
 * the total looked plausible until it was checked per currency.
 *
 *   settlement_major = gross_major × rate × divisor(presentment) / divisor(settlement)
 *
 * Any conversion that reads basket_payment_fees.exchange_rate must go through
 * here. The derived rows in basket_fx_rates do not: they are computed as
 * SUM(settlement_amount)/SUM(gross_amount), both already major, and are the safe
 * thing for a caller to multiply by.
 */
export function majorUnitRate(
  rate: number,
  presentmentCurrency: string,
  settlementCurrency: string,
): number {
  return rate * (minorUnitDivisor(presentmentCurrency) / minorUnitDivisor(settlementCurrency));
}
