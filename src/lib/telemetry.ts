// This app's server telemetry: the basket-tv-telemetry reporter (a no-op without
// TELEMETRY_TOKEN) and the wide events of the syncs. Server only.

import { createReporter, scrubMessage, type ErrorContext } from 'basket-tv-telemetry';
import {
  currentEvent,
  currentRequestId,
  emitThrottled,
  markError,
  runLogged,
  startEvent,
  type WideEvent,
} from 'basket-tv-telemetry/log';

export const telemetry = createReporter({
  app: 'analytics',
  ingestUrl: process.env.TELEMETRY_INGEST_URL,
  token: process.env.TELEMETRY_TOKEN,
});

/** The background runs, as their `kind: "job"` lines name them. */
export type JobRoute = 'basket_sync' | 'payments_sync' | 'partidos_sync';
/** Who started a run: the scheduler, the sync token, or an Analyst. */
export type JobTrigger = 'cron' | 'token' | 'analyst';

// A fatal step's error is reported by the step and then propagates out of the run.
const reported = new WeakSet<object>();

function reportOnce(err: unknown, context: ErrorContext): void {
  if (typeof err === 'object' && err !== null) {
    if (reported.has(err)) return;
    reported.add(err);
  }
  telemetry.reportServerError(err, context);
}

/**
 * An unexpected error the code caught and carries on from. It marks the current
 * wide event (outside one, a throttled line keyed by `route` and `step`) and is
 * reported once; the reporter takes `request_id` from the event.
 */
export function reportCaughtError(err: unknown, context: ErrorContext): void {
  const event = currentEvent();
  if (event) {
    markError(err, event);
  } else {
    const line = startEvent(context.route_type === 'action' ? 'action' : 'job', { route: context.route });
    markError(err, line);
    emitThrottled(`${context.route}:${context.step ?? ''}`, line);
  }
  reportOnce(err, context);
}

/**
 * One `kind: "job"` line for a run, with `trigger`, `duration_ms` and `outcome`.
 * Started from a request, it shares the request's `request_id`. A throw is marked
 * on the line, reported once and rethrown.
 */
export function runJob<T>(route: JobRoute, trigger: JobTrigger, fn: () => Promise<T>, fields: Partial<WideEvent> = {}): Promise<T> {
  const requestId = currentRequestId();
  const event = startEvent('job', { route, ...(requestId ? { request_id: requestId } : {}), trigger, ...fields });
  return runLogged(event, async () => {
    try {
      return await fn();
    } catch (err) {
      reportCaughtError(err, { route_type: 'job' });
      throw err;
    }
  });
}

/** One entry of the job line's `steps`; `error` only when the step threw. */
export interface JobStep {
  name: string;
  ok: boolean;
  rows: number;
  error?: { type: string; message: string };
}

/**
 * Add a finished step to the current job line. Each error a step threw (one per
 * failed item) is reported, with the step's name; a step the run survives
 * leaves the job's outcome as it is.
 */
export function recordJobStep(step: { name: string; ok: boolean; rows: number; errors?: readonly unknown[] }): void {
  const first = step.errors?.[0];
  const entry: JobStep = { name: step.name, ok: step.ok, rows: step.rows };
  if (first !== undefined) entry.error = describe(first);
  const event = currentEvent();
  // The line contract keeps business context one level deep; a run's steps are
  // the one list worth breaking it for, and they stay small (one entry per step).
  if (event) event.steps = [...((event.steps as unknown as JobStep[] | undefined) ?? []), entry] as never;
  for (const err of step.errors ?? []) reportOnce(err, { route_type: 'job', step: step.name });
}

/** Count a retry of a Provider or FX request on the current job line; outside one, a throttled line. */
export function countGatewayRetry(source: string): void {
  const event = currentEvent();
  if (event) {
    event.gateway_retries = (typeof event.gateway_retries === 'number' ? event.gateway_retries : 0) + 1;
  } else {
    emitThrottled(`gateway_retry:${source}`, startEvent('job', { route: 'gateway_retry', source, gateway_retries: 1 }));
  }
}

function describe(err: unknown): { type: string; message: string } {
  if (err instanceof Error) return { type: err.name || 'Error', message: scrubMessage(err.message) };
  return { type: 'NonError', message: scrubMessage(String(err)) };
}

const ERROR_KEYS = new Set(['error', 'lastError']);

/**
 * A copy of a result with every `error` / `lastError` string scrubbed, at any
 * depth: a Sync result nests the errors of each step, gateway, FX source and
 * inbox file. For state that an endpoint answers.
 */
export function scrubErrorFields<T>(value: T): T {
  if (Array.isArray(value)) return value.map((v) => scrubErrorFields(v)) as T;
  if (value === null || typeof value !== 'object' || value instanceof Date) return value;
  return Object.fromEntries(
    Object.entries(value).map(([k, v]) => [k, ERROR_KEYS.has(k) && typeof v === 'string' ? scrubMessage(v) : scrubErrorFields(v)]),
  ) as T;
}
