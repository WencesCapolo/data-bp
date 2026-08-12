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
