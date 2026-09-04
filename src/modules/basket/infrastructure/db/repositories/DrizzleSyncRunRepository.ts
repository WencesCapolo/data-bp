import { db, type Db } from '@shared/db/client';
import { basketSyncRuns } from '../schema';
import type { RunSyncResult } from '@basket/core/use-cases/sync/RunSyncUseCase';

export type SyncTrigger = 'cron' | 'token';

/** Postgres `undefined_table` — migration 0018 has not been applied yet. */
const UNDEFINED_TABLE = '42P01';

function isMissingTable(err: unknown): boolean {
  return typeof err === 'object' && err !== null && (err as { code?: string }).code === UNDEFINED_TABLE;
}

export class DrizzleSyncRunRepository {
  constructor(private readonly database: Db = db) {}

  /**
   * Log one finished run. Never throws: the mirror is already written by the
   * time this is called, and a missing log table must not read as a failed sync.
   */
  async record(entry: {
    trigger: SyncTrigger;
    actor: string;
    scope: string;
    startedAt: Date;
    result: RunSyncResult | null;
    error: string | null;
  }): Promise<void> {
    const finishedAt = new Date();
    const r = entry.result;
    try {
      await this.database.insert(basketSyncRuns).values({
        trigger: entry.trigger,
        actor: entry.actor,
        scope: entry.scope,
        startedAt: entry.startedAt,
        finishedAt,
        durationMs: finishedAt.getTime() - entry.startedAt.getTime(),
        usersSynced: r?.syncedUsers ?? null,
        contentSynced: r?.syncedContent ?? null,
        paymentsIngested: r?.syncedPayments ?? null,
        sheetsSynced: r
          ? r.syncedSheets.filter((x) => x.inserted >= 0).length +
            r.syncedFixtures.filter((x) => x.inserted >= 0).length +
            r.syncedDataMasters.filter((x) => x.teams >= 0).length
          : null,
        error: entry.error,
      });
    } catch (err) {
      if (!isMissingTable(err)) console.error('sync run not logged:', (err as Error).message);
    }
  }
}
