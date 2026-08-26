import type { FxRateProps } from '@basket/core/entities/FxRate';
import type { IFxRateSource } from '@basket/core/ports/IFxRate';
import { getJson } from '@basket/infrastructure/gateways/httpJson';

/**
 * Daily *oficial* quotes for five currencies against ARS, 2023-10-22 → today.
 * Same host as the blue history this codebase already fetches — no new
 * dependency, no key, no account.
 */
const HISTORY = 'https://api.argentinadatos.com/v1/cotizaciones';

const BASE = 'USD';
const QUOTE = 'EUR';
export const EUR_CROSS_SOURCE = 'oficial_cross';

interface CotizacionRow {
  moneda: string;
  compra: number | null;
  venta: number | null;
  fecha: string;
}

/**
 * How many consecutive absent days may be carried forward before the gap is
 * left as a gap.
 *
 * Fourteen, and the number is measured rather than chosen. Two kinds of hole
 * appear in this feed over the range EUR Pagos cover: single skipped days
 * (2026-02-02, 2026-08-01, 2026-08-06), and one **11-day run in July 2024**
 * where the source published a EUR leg of `1` that `cross` rejects. Bound this
 * at three and that run stays absent, which nulls not eleven days but the entire
 * two-year EUR total — a total is only published when every day inside it has a
 * rate.
 *
 * What carrying across that run actually costs: EUR/USD went 0,938648 on 07-11
 * to 0,940620 on 07-23, a move of **0,21%**, and 213,13 EUR of revenue falls
 * inside the hole. So the error introduced is under half a dollar, against
 * 29.451 USD that would otherwise read as `—`.
 *
 * Fourteen still leaves a real outage visible: a feed down for a month reads as
 * absent rather than as a month of one Friday's rate, which is the failure this
 * whole mechanism could otherwise cause.
 */
const MAX_CARRY_DAYS = 14;

export interface ArgentinaDatosEurUsdFetcherConfig {
  onRetry?: (info: { attempt: number; status: number | null; waitMs: number; reason: string }) => void;
  /** Override the carry-forward bound. Zero disables it entirely. */
  maxCarryDays?: number;
}

/**
 * EUR→USD, crossed through ARS.
 *
 * Nobody we already call quotes EUR against USD directly, and 27.742 EUR of
 * Stripe revenue therefore had no USD figure at all — `usdTotals` printed `—`
 * for it, which is honest but useless. What we *do* have is one endpoint that
 * quotes both EUR/ARS and USD/ARS on the same day from the same *oficial* table,
 * so the cross is:
 *
 *     EUR per USD  =  (ARS per USD) / (ARS per EUR)
 *
 * The ARS leg cancels. That matters more than it looks: both legs come from one
 * publication on one day, so the result carries no arbitrage between two
 * unrelated sources, and Argentina's ARS quotes being what they are is
 * irrelevant to a ratio of two of them.
 *
 * **Oficial, not blue, and deliberately.** The blue is a parallel ARS market;
 * there is no parallel EUR/USD. Crossing a blue USD leg with an oficial EUR leg
 * would manufacture a 30% error out of nothing. The two legs must come from the
 * same table, and `oficial` is the only table that quotes both.
 *
 * `venta` on both sides, matching the blue fetcher's choice, so the spread
 * mostly cancels rather than compounding. `compra` is carried for audit the same
 * way and is never converted with.
 *
 * The row is written as `(USD, EUR, 'oficial_cross')` — base USD like the blue
 * rows, so `usdConversion` divides a EUR figure by it and needs no second code
 * path. The source is part of the key (ADR 0007): this is a *derived* cross and
 * it says so, rather than posing as a quote somebody published.
 *
 * History only. There is a spot endpoint but no reason to call it: EUR Pagos
 * arrive from Stripe on a settlement delay, so today's EUR is never the day
 * being converted, and the history has yesterday.
 */
export class ArgentinaDatosEurUsdFetcher implements IFxRateSource {
  readonly source = EUR_CROSS_SOURCE;
  readonly baseCurrency = BASE;
  readonly quoteCurrency = QUOTE;

  constructor(private readonly cfg: ArgentinaDatosEurUsdFetcherConfig = {}) {}

  async fetch(since?: string): Promise<FxRateProps[]> {
    const rows = await getJson<CotizacionRow[]>(HISTORY, { onRetry: this.cfg.onRetry });

    // Both legs, indexed by day, before either is used: a day that quotes one
    // currency and not the other yields no rate rather than half of one.
    const usdArs = new Map<string, CotizacionRow>();
    const eurArs = new Map<string, CotizacionRow>();
    for (const row of rows) {
      const day = (row.fecha ?? '').slice(0, 10);
      if (!/^\d{4}-\d{2}-\d{2}$/.test(day)) continue;
      if (since && day < since) continue;
      const ccy = (row.moneda ?? '').trim().toUpperCase();
      if (ccy === 'USD') usdArs.set(day, row);
      else if (ccy === 'EUR') eurArs.set(day, row);
    }

    const quoted: FxRateProps[] = [];
    for (const [day, usd] of usdArs) {
      const eur = eurArs.get(day);
      if (!eur) continue;
      const rate = cross(usd.venta, eur.venta);
      if (rate === null) continue;
      quoted.push({
        day,
        baseCurrency: BASE,
        quoteCurrency: QUOTE,
        source: this.source,
        rate,
        buyRate: cross(usd.compra, eur.compra),
      });
    }

    quoted.sort((a, b) => (a.day < b.day ? -1 : 1));
    return fillPublicationGaps(quoted, this.cfg.maxCarryDays ?? MAX_CARRY_DAYS);
  }
}

/**
 * Repeats the last quote across days the feed skipped.
 *
 * Not a smoothing and not an interpolation. This source publishes a row for
 * **every calendar day** — it repeats Friday's quote through the weekend rather
 * than omitting Saturday — so a day with no row is the publisher missing a
 * publication, and the last quote it did publish is exactly what it would have
 * shown. Measured over the range EUR Pagos actually cover (2024-05-21 →
 * 2026-08-12): three absent days, each a single day, against 749 days of
 * revenue. Without this, one of them nulls the entire EUR figure, because a
 * total is only published when every day inside it had a rate.
 *
 * Bounded on purpose — see `MAX_CARRY_DAYS` for what the bound is worth in
 * dollars. A run longer than it is left absent, so a feed down for a month reads
 * as absent instead of as a month of one Friday's rate.
 *
 * A day whose legs `cross` rejected is a hole exactly like a day the feed never
 * published: both arrive here as an absent day, and both are the source failing
 * to publish a usable quote.
 */
function fillPublicationGaps(quoted: FxRateProps[], maxCarryDays: number): FxRateProps[] {
  if (maxCarryDays <= 0 || quoted.length === 0) return quoted;

  const out: FxRateProps[] = [];
  for (const row of quoted) {
    const previous = out[out.length - 1];
    if (previous) {
      const missing = daysBetween(previous.day, row.day) - 1;
      if (missing > 0 && missing <= maxCarryDays) {
        for (let i = 1; i <= missing; i += 1) {
          out.push({ ...previous, day: addDays(previous.day, i) });
        }
      }
    }
    out.push(row);
  }
  return out;
}

function daysBetween(from: string, to: string): number {
  return Math.round((Date.parse(`${to}T00:00:00Z`) - Date.parse(`${from}T00:00:00Z`)) / 86_400_000);
}

function addDays(day: string, n: number): string {
  return new Date(Date.parse(`${day}T00:00:00Z`) + n * 86_400_000).toISOString().slice(0, 10);
}

/**
 * The widest EUR/USD this can be and still be a EUR/USD.
 *
 * Not a tuning parameter — a corruption guard, and it has already earned itself.
 * On 11 days in July 2024 the source published the EUR leg as a flat `1` while
 * the USD leg stayed near 940, which crosses to **940 EUR per USD** and is not a
 * plausible anything. Stored, those days would have quietly multiplied that
 * week's EUR revenue by a thousand while every total downstream still looked
 * like a number. The pair has not left 0,7–1,7 in its entire history, so a cross
 * outside this band is a bad leg and the day is left absent — which the DTO
 * already knows how to say.
 */
const MIN_CROSS = 0.5;
const MAX_CROSS = 2;

/**
 * `(ARS per USD) / (ARS per EUR)` → EUR per USD, or null if either leg is
 * missing, non-positive, or crosses to something that is not a EUR/USD rate.
 * A zero or absent leg is not a rate of zero.
 */
function cross(arsPerUsd: number | null, arsPerEur: number | null): number | null {
  if (arsPerUsd == null || arsPerEur == null) return null;
  if (!(arsPerUsd > 0) || !(arsPerEur > 0)) return null;
  const crossed = arsPerUsd / arsPerEur;
  if (!(crossed >= MIN_CROSS) || !(crossed <= MAX_CROSS)) return null;
  // Six places: the cross sits near 0,86 and two places would quantise it to
  // ~0,1% steps, which on 27.742 EUR is tens of dollars of pure rounding.
  return Math.round((arsPerUsd / arsPerEur) * 1_000_000) / 1_000_000;
}
