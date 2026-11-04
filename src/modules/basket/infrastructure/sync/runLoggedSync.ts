import type { RunSyncResult } from '@basket/core/use-cases/sync/RunSyncUseCase';
import { DrizzleSyncRunRepository, type SyncTrigger } from '@basket/infrastructure/db/repositories/DrizzleSyncRunRepository';
import { composeRunSync } from '@basket/infrastructure/sync/composeRunSync';
import { addFields } from 'basket-tv-telemetry/log';
import { recordJobStep, runJob } from '@/lib/telemetry';

/**
 * Compose and execute a full Sync: one `kind: "job"` line with its steps, and one
 * row in basket_sync_runs, success or failure. Rethrows so callers keep their
 * own state.
 */
export function runLoggedSync(trigger: SyncTrigger, actor: string): Promise<RunSyncResult> {
  return runJob(
    'basket_sync',
    trigger,
    async () => {
      const startedAt = new Date();
      const log = new DrizzleSyncRunRepository();
      try {
        const result = await (await composeRunSync()).execute(recordJobStep);
        addFields({ inbox_files: result.exportInbox?.files.length ?? 0 });
        await log.record({ trigger, actor, scope: 'full', startedAt, result, error: null });
        return result;
      } catch (err) {
        const message = err instanceof Error ? err.message : String(err);
        await log.record({ trigger, actor, scope: 'full', startedAt, result: null, error: message });
        throw err;
      }
    },
    { gateway_retries: 0 },
  );
}
