// The runner. Takes an ordered list of steps, loops once, applies each step's
// declared policy, folds what each contributes into one RunSyncResult. This is
// the one place that decides abort-versus-continue; the steps themselves live
// in syncSteps.ts and the list per scope in buildSyncSteps.ts.

import {
  assertStepOrder,
  emptyContribution,
  foldContribution,
  type StepContribution,
  type SyncContribution,
  type SyncRunContext,
  type SyncStep,
  type SyncStepFailure,
} from './SyncStep';
import { scrubMessage } from '@shared/lib/scrub';

export type { SheetSpec, FixtureSheetSpec, DataSheetSpec } from './syncSteps';
export type { SyncScope } from './buildSyncSteps';

export interface RunSyncResult extends SyncContribution {
  startedAt: string;
  finishedAt: string;
  durationMs: number;
  /** Never-fatal steps and per-item entries that threw. A fatal failure is a
   *  throw out of `execute`, not an entry here — `runLoggedSync` depends on that. */
  failedSteps: SyncStepFailure[];
}

export class RunSyncUseCase {
  constructor(private readonly steps: readonly SyncStep[]) {
    assertStepOrder(steps);
  }

  /** The step names, in order. For callers that want to say what will run. */
  get stepNames(): string[] {
    return this.steps.map((s) => s.name);
  }

  async execute(): Promise<RunSyncResult> {
    const startedAt = new Date();
    const ctx: SyncRunContext = { runAt: startedAt };
    let acc = emptyContribution();
    const failedSteps: SyncStepFailure[] = [];

    const fold = (part: StepContribution) => {
      acc = foldContribution(acc, part);
    };

    for (const step of this.steps) {
      switch (step.policy) {
        case 'fatal':
          try {
            fold(await step.run(ctx));
          } catch (err) {
            // The caller logs and reports what propagates.
            throw err;
          }
          break;

        case 'never-fatal':
          try {
            fold(await step.run(ctx));
          } catch (err) {
            // Logged and reported by the caller from failedSteps (reportFailedSteps).
            failedSteps.push({ step: step.name, error: message(err) });
          }
          break;

        case 'per-item':
          for (const item of step.items) {
            try {
              fold(await step.runItem(item, ctx));
            } catch (err) {
              failedSteps.push({ step: step.name, item: step.itemName(item), error: message(err) });
              fold(step.failedItem(item));
            }
          }
          break;
      }
    }

    const finishedAt = new Date();
    return {
      startedAt: startedAt.toISOString(),
      finishedAt: finishedAt.toISOString(),
      durationMs: finishedAt.getTime() - startedAt.getTime(),
      ...acc,
      failedSteps,
    };
  }
}

/** Scrubbed: failedSteps is stored as the Sync's result, which the sync endpoints answer. */
function message(err: unknown): string {
  return scrubMessage(err instanceof Error ? err.message : String(err));
}
