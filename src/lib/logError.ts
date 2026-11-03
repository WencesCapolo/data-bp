import { scrubMessage } from './scrub';

export type LogExtra = Record<string, string | number | boolean | null | undefined>;

/**
 * One console line for an unexpected error: `[tag] Type: message {extra}`, with
 * the message scrubbed the way the telemetry reporter scrubs it. Never the error
 * object itself, whose message or fields can carry the data a query was run
 * with. `extra` is for small, non-personal values (a route, a step, a status).
 * Safe on the client too.
 */
export function logError(tag: string, err: unknown, extra?: LogExtra): void {
  const type = err instanceof Error ? err.name || 'Error' : typeof err;
  const message = scrubMessage(err instanceof Error ? err.message : String(err));
  const fields = extra ? Object.entries(extra).filter(([, v]) => v !== undefined) : [];
  const suffix = fields.length > 0 ? ` ${JSON.stringify(Object.fromEntries(fields))}` : '';
  console.error(`[${tag}] ${type}: ${message}${suffix}`);
}
