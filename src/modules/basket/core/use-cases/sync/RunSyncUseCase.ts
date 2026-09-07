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
            console.error(`sync step ${step.name} failed, aborting:`, message(err));
            throw err;
          }
          break;

        case 'never-fatal':
          try {
            fold(await step.run(ctx));
          } catch (err) {
            const error = message(err);
            console.error(`sync step ${step.name} failed:`, error);
            failedSteps.push({ step: step.name, error });
          }
          break;

        case 'per-item':
          for (const item of step.items) {
            try {
              fold(await step.runItem(item, ctx));
            } catch (err) {
              const error = message(err);
              const name = step.itemName(item);
              console.error(`${step.name} ${name} failed:`, error);
              failedSteps.push({ step: step.name, item: name, error });
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

function message(err: unknown): string {
  return err instanceof Error ? err.message : String(err);
}
