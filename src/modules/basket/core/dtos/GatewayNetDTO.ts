// Net revenue as the payment gateways report it: fees, net, refunds and
// subscription state. Read by /financiero (the Economía tab) — see
// docs/handoff/financiero-dashboard-port.md.
// ---------------------------------------------------------------------------
// Gateway net revenue for every Provider whose fee mirror has rows — Stripe
// (API) and MercadoPago (Cobros Export). See the seam in
// basket_mat_gateway_net_daily. PayPal is deliberately outside it: it has no fee
// feed, and including it would render its transactions as costing nothing.
//
// Every counted figure is anchored to a Pago (migration 0020, GitHub #5): a fee
// row counts only when a successful Pago with the same Provider and Provider
// payment id exists and its Subscriber is known. Fee rows with no such Pago —
// another product sold through the same gateway account, or a Pagos Export not
// yet uploaded — are not dropped; they travel in `excludedOutsidePagos`, same
// shapes, so the tab can footnote the headline instead of silently shrinking it.
//
// Every money row carries its own `platform`, and totals are never summed
// across Providers OR across currencies. Today the two happen to coincide (MP
// settles ARS, Stripe USD/EUR) and that is an accident of the accounts, not a
// property to rely on.
//
// Two currency planes, never mixed (docs/adr/0005):
//   * SETTLEMENT — settlementCurrency, grossSettlement, fees, net. What Stripe
//     actually moved. The only plane where a fee ratio means anything.
//   * PRESENTMENT — currency, refundedAmount. What the subscriber was charged.
// A fee divided by a presentment gross is a meaningless number, so the two
// planes live in separate interfaces rather than separate fields of one row.
// ---------------------------------------------------------------------------

import type { SubscriptionLifecycle } from '../entities/GatewaySubscription';

/** Settlement plane. feePct = fees / grossSettlement, same-plane by construction. */
export interface SettlementTotal {
  platform: number;
  platformName: string;
  settlementCurrency: string;
  grossSettlement: number;
  /** The Provider's commission alone. */
  fees: number;
  /**
   * Tax withheld at source, kept out of `fees` on purpose. MercadoPago withholds
   * 5.5% of gross on top of its 1.8% commission; folding the two together would
   * report MP as costing four times what it charges and make the comparison
   * against Stripe's 6.5% meaningless. A commission is spent; a withholding is a
   * tax credit that comes back. Zero for Providers that withhold nothing.
   */
  taxes: number;
  net: number;
  txCount: number;
  /** Commission as a share of settled gross. Excludes tax — see `taxes`. */
  feePct: number;
  /** Withholding as a share of settled gross. */
  taxPct: number;
}

/** Settlement plane, bucketed on captured_at (true UTC). */
export interface NetDailyPoint {
  day: string;
  platform: number;
  platformName: string;
  settlementCurrency: string;
  grossSettlement: number;
  fees: number;
  taxes: number;
  net: number;
  txCount: number;
}

/** Settlement plane, bucketed on captured_at (true UTC). */
export interface NetMonthlyPoint {
  month: string;
  platform: number;
  platformName: string;
  settlementCurrency: string;
  grossSettlement: number;
  fees: number;
  taxes: number;
  net: number;
  txCount: number;
}

/**
 * Presentment plane. Never summed across currencies — 720 of the 1,033 refund
 * rows exceed their own settlement_amount, which is correct, not corrupt.
 */
export interface RefundTotal {
  platform: number;
  platformName: string;
  currency: string;
  refundedAmount: number;
  refundCount: number;
}

/**
 * Churn reads `status`, not `canceled_at`: 15,636 canceled subscriptions carry
 * no canceled_at, so a chart bucketed on that column drops 46% of them.
 * withCanceledAt is reported so the tab can say how much of the timeline is
 * datable.
 */
export interface SubscriptionStatusCount {
  platform: number;
  platformName: string;
  /** The Provider's own word: Stripe `active`, MercadoPago `authorized`. */
  status: string;
  /** The two vocabularies collapsed, so live subscribers are one number. */
  lifecycle: SubscriptionLifecycle;
  count: number;
  withCanceledAt: number;
}

/**
 * created is bucketed on created_at, canceled on canceled_at — the datable
 * subset. MercadoPago records no cancellation moment at all, so its rows carry
 * `canceled: 0` here and their churn lives only in the status counts.
 */
export interface SubscriptionMonthlyPoint {
  month: string;
  platform: number;
  platformName: string;
  created: number;
  canceled: number;
}

/**
 * Fee coverage against successful Pagos carrying a Provider id, all-time.
 * Deliberately not range-windowed: coverage moves when Pagos are ingested, so a
 * windowed figure reads as a coverage regression when it is really new Pagos.
 *
 * Bucketed by `idShape` because MercadoPago has two. A 'payment' can carry a
 * fee; a 'preapproval' — the 143,577 hex32 ids — is a subscription object that
 * never had one, so counting the two together produces a coverage figure that
 * is capped near 73% forever and reads as a permanent loss.
 */
export interface FeeCoverageRow {
  platform: number;
  platformName: string;
  currency: string;
  idShape: 'payment' | 'preapproval';
  successful: number;
  withFee: number;
  coveragePct: number;
}

/**
 * Which rate produced a USD figure.
 *
 *   'none'   — the figure was already USD. Not a conversion, and labelled as
 *              such so nobody reads an identity as a rate that was applied.
 *   'blue'   — dolarapi's informal ARS venta, per day, per docs/adr/0007.
 *   'stripe' — the rate Stripe itself applied, already in the fee mirror.
 *
 * `null` means no source quotes that currency: EUR today. The figure is then
 * null too — absent, never zero.
 */
export type FxRateSource = 'none' | 'blue' | 'stripe' | 'oficial_cross';

/**
 * A settlement total converted to USD, carrying its own provenance.
 *
 * Every money field is nullable and they are null together: a total is only
 * published when every day inside it had a rate. `daysMissingRate` is how the
 * tab says why a figure is absent, instead of showing a total that is quietly
 * short a week of revenue.
 */
export interface UsdSettlementTotal {
  platform: number;
  platformName: string;
  /** The currency this was converted FROM. The figures are USD. */
  settlementCurrency: string;
  grossUsd: number | null;
  feesUsd: number | null;
  taxesUsd: number | null;
  netUsd: number | null;
  rateSource: FxRateSource | null;
  /** Printable provenance, e.g. 'blue venta (dolarapi), USD→ARS, por día'. */
  rateLabel: string;
  daysConverted: number;
  daysMissingRate: number;
  /** Volume-weighted rate actually applied over the range; null for identity. */
  effectiveRate: number | null;
}

/** The same conversion at month grain. Null months are absent, not zero. */
export interface UsdMonthlyPoint {
  month: string;
  platform: number;
  platformName: string;
  settlementCurrency: string;
  grossUsd: number | null;
  feesUsd: number | null;
  netUsd: number | null;
  rateSource: FxRateSource | null;
  daysMissingRate: number;
}

export interface GatewayNetDTO {
  /** The seam, surfaced so the tab can label itself instead of hardcoding it.
   *  Every Provider with fee rows, joined — 'MercadoPago · Stripe'. */
  platformName: string;
  /** The same list unjoined, for a tab that wants to iterate rather than print. */
  platformNames: string[];
  /** The Providers whose subscriptions are mirrored, joined for a title:
   *  'Stripe · MercadoPago'. Derived from the rows present, not declared. */
  subscriptionPlatformName: string;
  settlementTotals: SettlementTotal[];
  netByDay: NetDailyPoint[];
  netByMonth: NetMonthlyPoint[];
  refundsByCurrency: RefundTotal[];
  subscriptionsByStatus: SubscriptionStatusCount[];
  subscriptionsByMonth: SubscriptionMonthlyPoint[];
  coverage: FeeCoverageRow[];
  /**
   * The settlement totals in USD, one row per Provider × settlement currency —
   * deliberately NOT summed into one number. Two Providers' USD figures can be
   * added; whether they should be is the tab's call, and a single total would
   * have hidden that EUR contributes nothing to it because nobody quotes it.
   */
  usdTotals: UsdSettlementTotal[];
  /** Month grain of the same conversion, for the series. */
  netUsdByMonth: UsdMonthlyPoint[];
  /**
   * Subscriptions have no user dimension (customer_id is not mapped to
   * basket_users), so the churn figures ignore the tab's filters. True whenever
   * filters are active, so the tab can say so rather than quietly lying.
   */
  subscriptionsIgnoreFilters: boolean;
  /**
   * Always true since migration 0020: both the filtered and the unfiltered path
   * count only fee rows anchored to a Pago, so toggling a filter narrows the
   * population instead of redefining it. Kept as a field so a consumer written
   * against the old contract still reads a truthful answer.
   */
  netExcludesUnmatchedFees: boolean;
  /**
   * The complement: fee rows with no Pago, over the same range and in the same
   * shapes as the counted side. Never affected by filters — a filter is a
   * predicate on the Pago, and these rows have none — so with a filter active
   * this is the whole account's complement, not the slice's.
   */
  excludedOutsidePagos: ExcludedOutsidePagos;
}

/**
 * Gateway money that is NOT a Pago. Per Provider × currency, never summed
 * across either — the same rule as the counted side. Empty arrays when every
 * fee row in range has its Pago.
 */
export interface ExcludedOutsidePagos {
  settlementTotals: SettlementTotal[];
  netByMonth: NetMonthlyPoint[];
  refundsByCurrency: RefundTotal[];
  usdTotals: UsdSettlementTotal[];
}
