// The mirror's answers to the preview's questions. Every method answers `null`
// on any failure — a table that predates its migration, a connection that went
// away — because the preview is advisory and must never claim every row would
// be skipped when it simply could not ask.

import { inArray, sql } from 'drizzle-orm';
import { db, type Db } from '@shared/db/client';
import type { IFeeUploadLookups, IPagosUploadLookups } from '@basket/core/ports/IUploadLookups';
import { basketPriceTiers, basketUsers } from '../db/schema';

/** Period, in days, of a monthly Pago — the only one Tiers resolve. */
const MONTHLY_RECURRENT = 30;

/** How many distinct Subscriber ids to ask about per statement. */
const ID_QUERY_CHUNK = 20_000;

export class DrizzlePagosUploadLookups implements IPagosUploadLookups {
  constructor(private readonly database: Db = db) {}

  async knownSubscriberIds(ids: number[]): Promise<Set<number> | null> {
    if (ids.length === 0) return new Set();
    try {
      const known = new Set<number>();
      for (let i = 0; i < ids.length; i += ID_QUERY_CHUNK) {
        const rows = await this.database
          .select({ id: basketUsers.id })
          .from(basketUsers)
          .where(inArray(basketUsers.id, ids.slice(i, i + ID_QUERY_CHUNK)));
        for (const row of rows) known.add(row.id);
      }
      return known;
    } catch {
      return null;
    }
  }

  async monthlyTierCurrencies(): Promise<Set<string> | null> {
    try {
      const rows = await this.database
        .select({ currency: basketPriceTiers.currency, recurrent: basketPriceTiers.recurrent })
        .from(basketPriceTiers);
      return new Set(
        rows
          .filter((r) => Number(r.recurrent) === MONTHLY_RECURRENT)
          .map((r) => r.currency.trim().toLowerCase()),
      );
    } catch {
      return null;
    }
  }
}

export class DrizzleFeeUploadLookups implements IFeeUploadLookups {
  constructor(private readonly database: Db = db) {}

  existingPagoIds(ids: string[], platform: number): Promise<Set<string> | null> {
    return this.existing(ids, 'basket_payments', platform);
  }

  existingFeeIds(ids: string[], platform: number): Promise<Set<string> | null> {
    return this.existing(ids, 'basket_payment_fees', platform);
  }

  /**
   * The id list goes down as ONE jsonb parameter rather than as an `IN (…)` of
   * ten thousand binds: a monthly Cobros Export is ~10k operations, and expanding
   * that into placeholders costs a statement Postgres has to parse from scratch
   * every time. `jsonb_array_elements_text` joins against the same partial index
   * the fee mirror already relies on.
   */
  private async existing(
    ids: string[],
    table: 'basket_payments' | 'basket_payment_fees',
    platform: number,
  ): Promise<Set<string> | null> {
    if (ids.length === 0) return new Set();
    try {
      const rows = await this.database.execute<{ id: string }>(sql`
        SELECT t.platform_payment_id AS id
        FROM ${sql.raw(table)} t
        JOIN jsonb_array_elements_text(${JSON.stringify(ids)}::jsonb) AS wanted(id)
          ON wanted.id = t.platform_payment_id
        WHERE t.platform = ${platform}
      `);
      return new Set((rows as unknown as { id: string }[]).map((r) => r.id));
    } catch {
      return null;
    }
  }
}
