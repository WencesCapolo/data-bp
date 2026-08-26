import { sql } from 'drizzle-orm';
import { db, type Db } from '@shared/db/client';
import { chunk } from '@shared/lib/chunk';
import type { FxRateProps } from '@basket/core/entities/FxRate';
import type { FxCoverage, IFxRateRepository } from '@basket/core/ports/IFxRate';
import { basketFxRates } from '../schema';

const UPSERT_BATCH_SIZE = 1000;

/** Stripe's platform number, as basket_payments uses it. */
const STRIPE_PLATFORM = 4;
export const STRIPE_SOURCE = 'stripe';

export class DrizzleFxRateRepository implements IFxRateRepository {
  constructor(private readonly database: Db = db) {}

  async upsertMany(rates: FxRateProps[]): Promise<number> {
    if (rates.length === 0) return 0;
    const deduped = new Map<string, FxRateProps>();
    for (const r of rates) {
      deduped.set(`${r.day}:${r.baseCurrency}:${r.quoteCurrency}:${r.source}`, r);
    }

    let total = 0;
    for (const batch of chunk([...deduped.values()], UPSERT_BATCH_SIZE)) {
      await this.database
        .insert(basketFxRates)
        .values(batch.map((r) => ({
          day: r.day,
          baseCurrency: r.baseCurrency,
          quoteCurrency: r.quoteCurrency,
          source: r.source,
          rate: r.rate.toFixed(10),
          buyRate: r.buyRate == null ? null : r.buyRate.toFixed(10),
        })))
        .onConflictDoUpdate({
          target: [
            basketFxRates.day,
            basketFxRates.baseCurrency,
            basketFxRates.quoteCurrency,
            basketFxRates.source,
          ],
          set: {
            rate: sql`excluded.rate`,
            buyRate: sql`excluded.buy_rate`,
            syncedAt: sql`NOW()`,
          },
        });
      total += batch.length;
    }
    return total;
  }

  async count(): Promise<number> {
    const [row] = await this.database
      .select({ value: sql<number>`COUNT(*)::int` })
      .from(basketFxRates);
    return row?.value ?? 0;
  }

  async coverage(): Promise<FxCoverage[]> {
    const rows = await this.database.execute<{
      source: string; base_currency: string; quote_currency: string;
      days: number; first_day: string | null; last_day: string | null;
    }>(sql`
      SELECT source, base_currency, quote_currency,
             COUNT(*)::int AS days,
             MIN(day)::text AS first_day,
             MAX(day)::text AS last_day
      FROM basket_fx_rates
      GROUP BY source, base_currency, quote_currency
      ORDER BY source, base_currency, quote_currency
    `);
    return (rows as unknown as {
      source: string; base_currency: string; quote_currency: string;
      days: number; first_day: string | null; last_day: string | null;
    }[]).map((r) => ({
      source: r.source,
      baseCurrency: r.base_currency,
      quoteCurrency: r.quote_currency,
      days: Number(r.days),
      firstDay: r.first_day,
      lastDay: r.last_day,
    }));
  }

  /**
   * The days a pair has no rate for. `generate_series` supplies the calendar so
   * an absent day is reported as absent rather than as the previous day's rate
   * carried forward — the blue history has every calendar day, weekends
   * included, so a hole means the feed broke.
   */
  async gaps(
    source: string, base: string, quote: string, from: string, to: string,
  ): Promise<string[]> {
    const rows = await this.database.execute<{ day: string }>(sql`
      SELECT d::date::text AS day
      FROM generate_series(${from}::date, ${to}::date, INTERVAL '1 day') AS d
      WHERE NOT EXISTS (
        SELECT 1 FROM basket_fx_rates r
        WHERE r.day = d::date
          AND r.source = ${source}
          AND r.base_currency = ${base}
          AND r.quote_currency = ${quote}
      )
      ORDER BY 1
    `);
    return (rows as unknown as { day: string }[]).map((r) => r.day);
  }

  /**
   * Rebuilds the derived Stripe rows.
   *
   * Stripe reports `exchange_rate` per balance transaction — presentment to
   * settlement, as it applied it that day — so the rate is already in the fee
   * mirror and this table does not need to fetch it. What it does need is a
   * *nameable* daily rate: a converted Stripe figure has to be able to say what
   * produced it, and "the row's own rate" cannot be printed next to a monthly
   * total.
   *
   * Weighted by gross, not averaged: an unweighted mean of a day's rates lets a
   * single small charge move the published rate as much as a large one.
   *
   * A day whose charges Stripe reported no rate for (USD into USD — the plane
   * collapses) yields no row. That is not a gap: there is nothing to convert.
   */
  async refreshDerivedStripeRates(): Promise<number> {
    const rows = await this.database.execute<{ n: number }>(sql`
      WITH derived AS (
        SELECT captured_at::date                                  AS day,
               currency                                           AS base_currency,
               settlement_currency                                AS quote_currency,
               SUM(settlement_amount) / NULLIF(SUM(gross_amount), 0) AS rate
        FROM basket_payment_fees
        WHERE platform = ${STRIPE_PLATFORM}
          AND captured_at IS NOT NULL
          AND exchange_rate IS NOT NULL
          AND gross_amount > 0
          AND settlement_amount > 0
          AND currency <> settlement_currency
        GROUP BY 1, 2, 3
      ),
      upserted AS (
        INSERT INTO basket_fx_rates (day, base_currency, quote_currency, source, rate, buy_rate)
        SELECT day, base_currency, quote_currency, ${STRIPE_SOURCE}, rate, NULL
        FROM derived
        WHERE rate IS NOT NULL AND rate > 0
        ON CONFLICT (day, base_currency, quote_currency, source)
        DO UPDATE SET rate = excluded.rate, synced_at = NOW()
        RETURNING 1
      )
      SELECT COUNT(*)::int AS n FROM upserted
    `);
    const [row] = rows as unknown as { n: number }[];
    return Number(row?.n ?? 0);
  }
}
