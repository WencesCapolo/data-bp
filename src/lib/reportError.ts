import { logError, type LogExtra } from './logError';
import { reportServerError, type ErrorContext } from './telemetry';

/** The background jobs, as basket-telemetry groups them (`context.route` with `routeType: 'job'`). */
export type JobRoute = 'payments-sync' | 'partidos-sync' | 'basket-sync' | 'sync-scheduler';

/**
 * An error nobody expected, caught before Next's `onRequestError` could see it:
 * one scrubbed log line and one report to basket-telemetry. Server only.
 */
export function reportUnexpected(tag: string, err: unknown, context: ErrorContext): void {
  const logged: Record<string, unknown> = { ...context };
  delete logged.userId; // reported, never printed
  logError(tag, err, logged as LogExtra);
  reportServerError(err, context);
}

/** A background job that failed as a whole, or at one `step` of it. */
export function reportJobFailure(route: JobRoute, err: unknown, step?: string): void {
  reportUnexpected(route, err, { routeType: 'job', route, ...(step ? { step } : {}) });
}

/**
 * The steps a Sync survived without (`RunSyncResult.failedSteps`): the run
 * itself succeeded, so nothing else reports them. One report per failure,
 * grouped by step; the item (a sheet, a gateway) stays in the sync log.
 */
export function reportFailedSteps(route: JobRoute, failures: readonly { step: string; error: string }[]): void {
  for (const f of failures) {
    const err = new Error(f.error);
    err.name = 'SyncStepError';
    reportJobFailure(route, err, f.step);
  }
}
