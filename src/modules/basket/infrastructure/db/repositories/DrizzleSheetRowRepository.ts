import { eq, sql } from 'drizzle-orm';
import { db, type Db } from '@shared/db/client';
import { chunk } from '@shared/lib/chunk';
import type { ISheetRowRepository, SheetRowProps } from '@basket/core/ports/ISheetRowRepository';
import { basketSheetRows } from '../schema';

const BATCH = 500;

export class DrizzleSheetRowRepository implements ISheetRowRepository {
  constructor(private readonly database: Db = db) {}

  async upsertMany(rows: SheetRowProps[]): Promise<number> {
    if (rows.length === 0) return 0;
    let total = 0;
    for (const batch of chunk(rows, BATCH)) {
      await this.database
        .insert(basketSheetRows)
        .values(batch.map((r) => ({ sheet: r.sheet, rowKey: r.rowKey, data: r.data, syncedAt: sql`NOW()` })))
        .onConflictDoUpdate({
          target: [basketSheetRows.sheet, basketSheetRows.rowKey],
          set: { data: sql`excluded.data`, syncedAt: sql`NOW()` },
        });
      total += batch.length;
    }
    return total;
  }

  async countBySheet(sheet: string): Promise<number> {
    const rows = await this.database
      .select({ c: sql<number>`COUNT(*)::int` })
      .from(basketSheetRows)
      .where(eq(basketSheetRows.sheet, sheet));
    return Number(rows[0]?.c ?? 0);
  }
}
