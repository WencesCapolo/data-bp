import cron, { type ScheduledTask } from 'node-cron';
import { composeRunSync } from '@basket/infrastructure/sync/composeRunSync';
import { runLoggedSync } from '@basket/infrastructure/sync/runLoggedSync';

const GLOBAL_KEY = Symbol.for('basket.syncScheduler');

interface SchedulerState {
  task: ScheduledTask;
  running: boolean;
  lastError: string | null;
  lastRunAt: Date | null;
}

type GlobalWithScheduler = typeof globalThis & {
  [GLOBAL_KEY]?: SchedulerState;
};

function intervalToCron(hours: number): string {
  if (hours <= 0 || !Number.isFinite(hours)) return '0 */6 * * *';
  if (hours < 1) return `*/${Math.max(1, Math.round(hours * 60))} * * * *`;
  return `0 */${Math.min(23, Math.round(hours))} * * *`;
}

export function startSyncScheduler(): void {
  if (process.env.NODE_ENV !== 'production') return;
  if (typeof window !== 'undefined') return;

  const g = globalThis as GlobalWithScheduler;
  if (g[GLOBAL_KEY]) return;

  const hours = Number(process.env.SYNC_INTERVAL_HOURS ?? '6');
  const expr = intervalToCron(hours);

  const state: SchedulerState = { task: null as unknown as ScheduledTask, running: false, lastError: null, lastRunAt: null };

  state.task = cron.schedule(expr, async () => {
    if (state.running) return;
    state.running = true;
    state.lastError = null;
    try {
      const useCase = await composeRunSync();
      await runLoggedSync(useCase, 'cron', 'SyncScheduler');
    } catch (err) {
      state.lastError = err instanceof Error ? err.message : String(err);
      console.error('[SyncScheduler] sync failed:', state.lastError);
    } finally {
      state.lastRunAt = new Date();
      state.running = false;
    }
  });

  g[GLOBAL_KEY] = state;
  console.log(`[SyncScheduler] started (cron="${expr}")`);
}
