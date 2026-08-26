// Turning settlement figures into USD, and saying which rate did it.
//
// Every money figure on /financiero is denominated in a Provider's own currency
// because there was no rate table to convert them with. There is one now
// (basket_fx_rates, migration 0017), and this is the only place a conversion
// happens — so the answer to "what rate produced this number" is one function
// and not a habit spread across a query, a DTO and a chart.
//
// Three rules, and none of them is a fallback:
//
//   * A USD figure is not converted at all. rateSource 'none' says so; calling
//     it 'blue' because the tab wants a label would claim a conversion happened.
//   * ARS converts at that day's blue venta. Per DAY, never per month: a 2024
//     Pago converted at 2026's rate is the fastest way to publish a wrong
//     revenue figure, and monthly ARS inflation makes the error enormous rather
//     than academic.
//   * EUR converts at that day's oficial EUR/USD cross. Nobody quotes EUR→USD
//     to us directly, but one endpoint quotes EUR/ARS and USD/ARS on the same
//     day from the same table, so the ARS leg cancels. Both legs must come from
//     that one table — crossing a blue USD leg with an oficial EUR leg invents a
//     30% error. See ArgentinaDatosEurUsdFetcher.
//   * A currency no source quotes converts to null, and every figure downstream
//     of it stays null. Zero would say we converted it and got nothing; null
//     says nobody quoted it.
//
// A total is null unless every day inside it had a rate. `daysMissingRate` is
// how a caller says *why* rather than showing a number that is quietly short a
// week. The blue history carries every calendar day including weekends, so in
// practice this only fires when the feed broke.

import type { NetDailyPoint } from '@basket/core/dtos/GatewayNetDTO';
import type { FxRateSource, UsdMonthlyPoint, UsdSettlementTotal } from '@basket/core/dtos/GatewayNetDTO';

/** One day's rate for one pair, as basket_fx_rates holds it: quote per base. */
export interface DailyRate {
  day: string;
  /** The non-USD side. Base is always USD in this table's blue rows. */
  quoteCurrency: string;
  source: string;
  rate: number;
}

/** `USD per settlement currency`, keyed day → currency. */
export type RateIndex = Map<string, Map<string, DailyRate>>;

export function indexRates(rates: DailyRate[]): RateIndex {
  const idx: RateIndex = new Map();
  for (const r of rates) {
    if (!(r.rate > 0)) continue;
    let byCcy = idx.get(r.day);
    if (!byCcy) { byCcy = new Map(); idx.set(r.day, byCcy); }
    byCcy.set(r.quoteCurrency.toUpperCase(), r);
  }
  return idx;
}

export const USD = 'USD';

/** What produced a USD figure, printable next to it. */
export function rateLabel(source: FxRateSource | null, ccy: string): string {
  if (source === 'none') return `sin conversión — ${ccy} es la moneda de liquidación`;
  if (source === 'blue') return `blue venta (dolarapi), USD→${ccy}, por día`;
  if (source === 'stripe') return `tipo de cambio de Stripe, ${ccy}→USD, por transacción`;
  if (source === 'oficial_cross')
    return `oficial (argentinadatos), USD→${ccy} cruzado por ARS, por día`;
  return `sin cotización para ${ccy} — la cifra en USD queda ausente`;
}

interface Accumulator {
  platform: number;
  platformName: string;
  settlementCurrency: string;
  grossUsd: number;
  feesUsd: number;
  taxesUsd: number;
  netUsd: number;
  /** Settlement-currency gross over the converted days, for the effective rate. */
  grossNative: number;
  daysConverted: number;
  daysMissingRate: number;
  source: FxRateSource | null;
}

function key(platform: number, ccy: string): string {
  return `${platform}:${ccy}`;
}

function blank(row: NetDailyPoint): Accumulator {
  return {
    platform: row.platform,
    platformName: row.platformName,
    settlementCurrency: row.settlementCurrency,
    grossUsd: 0, feesUsd: 0, taxesUsd: 0, netUsd: 0, grossNative: 0,
    daysConverted: 0, daysMissingRate: 0,
    source: null,
  };
}

/**
 * Adds one day into an accumulator, or records the day as unconvertible.
 *
 * The rate is applied to gross, fees, taxes and net separately rather than to
 * net alone and derived: `gross - fees - taxes = net` is an invariant the whole
 * pipeline relies on, and converting one term and subtracting the others in a
 * different currency would break it at the second decimal.
 */
function add(acc: Accumulator, row: NetDailyPoint, rates: RateIndex): void {
  const ccy = row.settlementCurrency.toUpperCase();

  if (ccy === USD) {
    acc.source = 'none';
    acc.grossUsd += row.grossSettlement;
    acc.feesUsd += row.fees;
    acc.taxesUsd += row.taxes;
    acc.netUsd += row.net;
    acc.grossNative += row.grossSettlement;
    acc.daysConverted += 1;
    return;
  }

  const rate = rates.get(row.day)?.get(ccy);
  if (!rate) {
    acc.daysMissingRate += 1;
    return;
  }

  acc.source = rate.source === 'blue' ? 'blue' : (rate.source as FxRateSource);
  // Divide: the row holds ARS and the rate is ARS per USD.
  acc.grossUsd += row.grossSettlement / rate.rate;
  acc.feesUsd += row.fees / rate.rate;
  acc.taxesUsd += row.taxes / rate.rate;
  acc.netUsd += row.net / rate.rate;
  acc.grossNative += row.grossSettlement;
  acc.daysConverted += 1;
}

function round2(n: number): number {
  return Math.round(n * 100) / 100;
}

function finish(acc: Accumulator): UsdSettlementTotal {
  // Incomplete means absent, not short. A total missing a week of rates looks
  // exactly like a bad week otherwise.
  const complete = acc.daysMissingRate === 0 && acc.daysConverted > 0;
  return {
    platform: acc.platform,
    platformName: acc.platformName,
    settlementCurrency: acc.settlementCurrency,
    grossUsd: complete ? round2(acc.grossUsd) : null,
    feesUsd: complete ? round2(acc.feesUsd) : null,
    taxesUsd: complete ? round2(acc.taxesUsd) : null,
    netUsd: complete ? round2(acc.netUsd) : null,
    rateSource: acc.source,
    rateLabel: rateLabel(acc.source, acc.settlementCurrency),
    daysConverted: acc.daysConverted,
    daysMissingRate: acc.daysMissingRate,
    // Volume-weighted, so a day with two pesos of revenue does not move the
    // published rate as much as a day with two million. Null where nothing was
    // converted, and for USD where nothing was.
    effectiveRate:
      acc.source && acc.source !== 'none' && acc.grossUsd > 0
        ? Math.round((acc.grossNative / acc.grossUsd) * 10_000) / 10_000
        : null,
  };
}

/** Range totals per Provider × settlement currency, converted day by day. */
export function usdTotals(days: NetDailyPoint[], rates: RateIndex): UsdSettlementTotal[] {
  const acc = new Map<string, Accumulator>();
  for (const row of days) {
    const k = key(row.platform, row.settlementCurrency);
    let a = acc.get(k);
    if (!a) { a = blank(row); acc.set(k, a); }
    add(a, row, rates);
  }
  return [...acc.values()]
    .map(finish)
    .sort((a, b) => (b.grossUsd ?? -1) - (a.grossUsd ?? -1));
}

/** The same conversion at month grain, for the tab's series. */
export function usdByMonth(days: NetDailyPoint[], rates: RateIndex): UsdMonthlyPoint[] {
  const acc = new Map<string, { month: string; a: Accumulator }>();
  for (const row of days) {
    const month = `${row.day.slice(0, 7)}-01`;
    const k = `${month}:${key(row.platform, row.settlementCurrency)}`;
    let hit = acc.get(k);
    if (!hit) { hit = { month, a: blank(row) }; acc.set(k, hit); }
    add(hit.a, row, rates);
  }
  return [...acc.values()]
    .map(({ month, a }) => {
      const t = finish(a);
      return {
        month,
        platform: t.platform,
        platformName: t.platformName,
        settlementCurrency: t.settlementCurrency,
        grossUsd: t.grossUsd,
        feesUsd: t.feesUsd,
        netUsd: t.netUsd,
        rateSource: t.rateSource,
        daysMissingRate: t.daysMissingRate,
      };
    })
    .sort((x, y) => (x.month < y.month ? -1 : x.month > y.month ? 1 : x.settlementCurrency < y.settlementCurrency ? -1 : 1));
}
