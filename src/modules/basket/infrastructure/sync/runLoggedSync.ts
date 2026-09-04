import type { RunSyncResult, RunSyncUseCase } from '@basket/core/use-cases/sync/RunSyncUseCase';
import { DrizzleSyncRunRepository, type SyncTrigger } from '@basket/infrastructure/db/repositories/DrizzleSyncRunRepository';

/**
 * Execute a Sync and leave one row in basket_sync_runs, success or failure.
 * Rethrows so callers keep their own error handling.
 */
export async function runLoggedSync(
  useCase: RunSyncUseCase,
  trigger: SyncTrigger,
  actor: string,
  scope: string = 'full',
): Promise<RunSyncResult> {
  const startedAt = new Date();
  const log = new DrizzleSyncRunRepository();
  try {
    const result = await useCase.execute();
    await log.record({ trigger, actor, scope, startedAt, result, error: null });
    return result;
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err);
    await log.record({ trigger, actor, scope, startedAt, result: null, error: message });
    throw err;
  }
}
