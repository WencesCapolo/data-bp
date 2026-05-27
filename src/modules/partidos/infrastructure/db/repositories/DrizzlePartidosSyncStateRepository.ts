import { eq } from 'drizzle-orm';
import { db, type Db } from '@shared/db/client';
import type {
  IPartidosSyncStateRepository,
  PartidosSyncState,
} from '@partidos/core/ports/IPartidosSyncStateRepository';
import { partidosSyncState } from '../schema';

const SINGLETON_ID = 1;

export class DrizzlePartidosSyncStateRepository implements IPartidosSyncStateRepository {
  constructor(private readonly database: Db = db) {}

  async get(): Promise<PartidosSyncState> {
    const rows = await this.database
      .select()
      .from(partidosSyncState)
      .where(eq(partidosSyncState.id, SINGLETON_ID))
      .limit(1);
    const r = rows[0];
    if (!r) {
      return {
        lastSyncAt: null,
        lastCountNacional: 0,
        lastCountIntl: 0,
        lastError: null,
        lastDurationMs: null,
      };
    }
    return {
      lastSyncAt: r.lastSyncAt,
      lastCountNacional: r.lastCountNacional,
      lastCountIntl: r.lastCountIntl,
      lastError: r.lastError,
      lastDurationMs: r.lastDurationMs,
    };
  }

  async update(state: PartidosSyncState): Promise<void> {
    await this.database
      .insert(partidosSyncState)
      .values({
        id: SINGLETON_ID,
        lastSyncAt: state.lastSyncAt,
        lastCountNacional: state.lastCountNacional,
        lastCountIntl: state.lastCountIntl,
        lastError: state.lastError,
        lastDurationMs: state.lastDurationMs,
      })
      .onConflictDoUpdate({
        target: partidosSyncState.id,
        set: {
          lastSyncAt: state.lastSyncAt,
          lastCountNacional: state.lastCountNacional,
          lastCountIntl: state.lastCountIntl,
          lastError: state.lastError,
          lastDurationMs: state.lastDurationMs,
        },
      });
  }
}
