// The subscriber lifecycle at day grain, derived from Pagos alone.
//
// Everything here is about *Subscribers*, not about Provider subscriptions: a
// Subscriber is in the pool on a day when some successful Pago covers that day
// (created_at ≤ day ≤ expires_at + 7 days of grace, the same rule every active
// count in this app uses). Entering the pool is an alta, leaving it a baja, and
// the day-to-day difference of the pool is exactly altas − bajas — the invariant
// `pnpm smoke:lifecycle` asserts.
//
// The one figure that reads Provider subscriptions rather than Pagos is the
// last-charge distribution: a Provider still calling a subscription live while
// its last charge is months old is the zombie the prototype's chart exists to
// show, and that can only be seen by putting the two sources side by side.

/** One day of the pool: who came in, who left, how many were in it at close. */
export interface DailyLifecyclePoint {
  day: string;
  /** First successful Pago of their life landed this day. */
  newSubscribers: number;
  /** Back in the pool after having left it (a renewal after the grace ran out). */
  reactivated: number;
  /** In the pool the day before, not today. */
  churned: number;
  /** newSubscribers + reactivated − churned; equals active − previous active. */
  net: number;
  /** Subscribers in the pool at the close of the day. */
  active: number;
}

/**
 * Pagos of a month bucketed by what they meant for the Subscriber, plus the
 * Subscribers whose coverage ran out that month with nothing renewing it.
 *
 * `recurring` vs `reactivated` splits on a 37-day gap after the previous
 * Pago's expiry, the same threshold basket_mat_monthly_lifecycle uses, so the
 * monthly buckets here and the Retención tab agree.
 */
export interface MonthlyLifecyclePoint {
  month: string;
  newSubscribers: number;
  recurring: number;
  reactivated: number;
  /** A paid Pago with no recurring right (recurrent = 0): a single match. */
  oneOff: number;
  /** Subscribers whose last coverage (expiry + grace) ended in the month with no
   *  later Pago overlapping it. Derived from Pagos, so every Provider counts —
   *  unlike the Providers' own dated cancellations, which MercadoPago lacks. */
  churned: number;
  /** Subscription Pagos (never a one-off) under a Mensual Tier — the prototype's
   *  "Transacciones por plan · Mensual vs Anual", month by month. */
  mensual: number;
  /** The same, under the Anual Tier. mensual + anual ≤ new + recurring + reactivated:
   *  a Free right is neither. */
  anual: number;
}

/**
 * Pagos of a window bucketed the way `MonthlyLifecyclePoint` buckets a month,
 * plus the Subscribers who left the pool inside it. The window is a run of days,
 * not a month, so a Pago's bucket is decided by the Subscriber's whole history
 * and only its date decides which window it lands in.
 */
export interface WindowTx {
  newSubscribers: number;
  recurring: number;
  reactivated: number;
  oneOff: number;
  churned: number;
  mensual: number;
  anual: number;
  /** newSubscribers + recurring + reactivated + oneOff: the payment events. */
  total: number;
}

/** The pool at the close of one day, split two ways that do not add up to
 *  `total`: a Subscriber holding two rights counts in both Periods and both
 *  families, and once in the total. */
export interface WindowActive {
  total: number;
  mensual: number;
  anual: number;
  /** Under a Total Tier, monthly or annual. */
  famTotal: number;
  /** Under the Básico Tier. */
  famBasico: number;
}

/**
 * One side of the rolling comparison: the days `start`..`end` inclusive, what
 * was paid inside them, who was in the pool at `end`, and what the Providers
 * settled — converted to USD day by day, per Provider, and null where a day
 * had no rate (see GatewayNetDTO.UsdSettlementTotal).
 */
export interface PeriodWindow {
  start: string;
  end: string;
  tx: WindowTx;
  active: WindowActive;
  netUsdByPlatform: { platform: number; platformName: string; netUsd: number | null }[];
  /**
   * Gateway net in the same window that is NOT a Pago (migration 0020): charges
   * the gateway account took that the Control Panel never ledgered. Same shape,
   * never added to `netUsdByPlatform`; the tab footnotes it. Ignores filters —
   * these rows have no Subscriber to filter on.
   */
  outsidePagosNetUsdByPlatform: { platform: number; platformName: string; netUsd: number | null }[];
}

/**
 * The prototype's "Últimos N días vs N días anteriores": two windows of the
 * same length ending at `asOf` and the day before the current one starts. Not
 * calendar months — a month in progress compared against a whole month reads
 * as a collapse every day until the 30th.
 */
export interface PeriodComparison {
  windowDays: number;
  current: PeriodWindow;
  previous: PeriodWindow;
}

/** Distinct Subscribers in the pool at the close of a month, by Period. */
export interface ActiveByMonthPoint {
  month: string;
  /** Under any Mensual Tier. A Subscriber holding both a monthly and an annual
   *  right counts in both columns and once in `total`. */
  mensual: number;
  anual: number;
  /** Neither: a Free right or a one-off. In the pool, but not a subscription. */
  otros: number;
  total: number;
  /** The month the Pagos end in: measured at the last Pago day, not month end. */
  partial: boolean;
}

export type LastChargeBucket = '0-30' | '31-60' | '61-90' | '91-180' | '180+' | 'unknown';

/**
 * Provider subscriptions the Provider calls live, by how long ago their last
 * successful Pago was — measured at `asOf`, the last Pago day, so a stale Upload
 * does not age every subscription at once.
 *
 * `unknown` is a live subscription no Pago could be tied to: a Stripe customer
 * whose email matches no Subscriber, or a MercadoPago preapproval no Pago names.
 * Kept as a bucket rather than dropped so the bars still sum to the live count.
 */
export interface LastChargeRow {
  platform: number;
  platformName: string;
  bucket: LastChargeBucket;
  count: number;
}

/**
 * How long a Subscriber stays, in months of paid coverage, over closed
 * lifetimes only — Subscribers not in the pool at `asOf`. A Subscriber who left
 * and came back is one lifetime, its months added up. Open lifetimes are
 * counted, not averaged: their story is not over.
 */
export interface LifetimeStats {
  closed: number;
  open: number;
  meanMonths: number | null;
  medianMonths: number | null;
  p25Months: number | null;
  p75Months: number | null;
  maxMonths: number | null;
}

export interface SubscriberLifecycleDTO {
  /** The last day with a Pago (capped at yesterday). The daily series ends here
   *  and the snapshots are taken here: after the last Upload every day would
   *  show zero altas against real bajas, a collapse that never happened. */
  asOf: string;
  /** The 15 days ending at `asOf`, whatever the range: it is a pulse, not a cut. */
  daily: DailyLifecyclePoint[];
  /** Months the range touches, up to the month of `asOf`. */
  monthly: MonthlyLifecyclePoint[];
  activeByMonth: ActiveByMonthPoint[];
  /** Snapshot at `asOf`, all-time. Ignores the tab's filters: a subscription has
   *  no Subscriber dimension, see GatewayNetDTO.subscriptionsIgnoreFilters. */
  lastCharge: LastChargeRow[];
  /** All-time at `asOf`, honouring the filters. */
  lifetime: LifetimeStats;
  /** The rolling 30-day pair, honouring the filters. */
  periodComparison: PeriodComparison;
}
