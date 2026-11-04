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
  type SyncStepOutcome,
  hasFailedPart,
  rowsOf,
} from './SyncStep';

export type { SheetSpec, FixtureSheetSpec, DataSheetSpec } from './syncSteps';
export type { SyncScope } from './buildSyncSteps';

export interface RunSyncResult extends SyncContribution {
  startedAt: string;
  finishedAt: string;
  durationMs: number;
  /** Never-fatal steps and per-item entries that threw, with the error's message
   *  as it was (the caller scrubs what it stores or answers). A fatal failure is
   *  a throw out of `execute`, not an entry here — `runLoggedSync` depends on that. */
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

  /** `onStep` hears each step as it ends, the fatal one included, before its error propagates. */
  async execute(onStep: (outcome: SyncStepOutcome) => void = () => {}): Promise<RunSyncResult> {
    const startedAt = new Date();
    const ctx: SyncRunContext = { runAt: startedAt };
    let acc = emptyContribution();
    const failedSteps: SyncStepFailure[] = [];

    for (const step of this.steps) {
      let part = emptyContribution();
      const errors: unknown[] = [];
      const fold = (p: StepContribution) => {
        acc = foldContribution(acc, p);
        part = foldContribution(part, p);
      };
      try {
        switch (step.policy) {
          case 'fatal':
            // The caller logs and reports what propagates.
            fold(await step.run(ctx));
            break;

          case 'never-fatal':
            try {
              fold(await step.run(ctx));
            } catch (err) {
              errors.push(err);
              failedSteps.push({ step: step.name, error: message(err) });
            }
            break;

          case 'per-item':
            for (const item of step.items) {
              try {
                fold(await step.runItem(item, ctx));
              } catch (err) {
                errors.push(err);
                failedSteps.push({ step: step.name, item: step.itemName(item), error: message(err) });
                fold(step.failedItem(item));
              }
            }
            break;
        }
      } catch (err) {
        errors.push(err);
        throw err;
      } finally {
        onStep({ name: step.name, ok: errors.length === 0 && !hasFailedPart(part), rows: rowsOf(part), errors });
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
