import { eq, sql } from 'drizzle-orm';
import { db, type Db } from '@shared/db/client';
import type { ISyncStateRepository, SyncStateRecord } from '@basket/core/ports/ISyncStateRepository';
import { basketSyncState } from '../schema';

export class DrizzleSyncStateRepository implements ISyncStateRepository {
  constructor(private readonly database: Db = db) {}

  async getLastSync(source: string): Promise<Date | null> {
    const rows = await this.database
      .select()
      .from(basketSyncState)
      .where(eq(basketSyncState.source, source))
      .limit(1);
    return rows[0]?.lastSync ?? null;
  }

  async updateLastSync(source: string, date: Date, rowCount?: number): Promise<void> {
    await this.database
      .insert(basketSyncState)
      .values({ source, lastSync: date, rowCount: rowCount ?? null })
      .onConflictDoUpdate({
        target: basketSyncState.source,
        set: {
          lastSync: sql`excluded.last_sync`,
          rowCount: sql`excluded.row_count`,
        },
      });
  }

  async findAll(): Promise<SyncStateRecord[]> {
    const rows = await this.database.select().from(basketSyncState);
    return rows.map((r) => ({ source: r.source, lastSync: r.lastSync, rowCount: r.rowCount }));
  }
}
