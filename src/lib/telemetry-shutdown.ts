import { flush } from './telemetry';

const REGISTERED = Symbol.for('analytics.telemetryShutdown');

/**
 * On SIGTERM/SIGINT (pm2 restart, deploy) start sending what the reporter still
 * has queued (≤ 1.5 s). Best effort: under `next start`, Next's own handler
 * closes the server and exits, possibly before the request completes. Node
 * only: loaded from `register()` in `src/instrumentation.ts`.
 */
export function flushTelemetryOnShutdown(): void {
  const g = globalThis as typeof globalThis & { [REGISTERED]?: true };
  if (g[REGISTERED]) return;
  g[REGISTERED] = true;

  for (const signal of ['SIGTERM', 'SIGINT'] as const) {
    process.once(signal, () => void flush());
  }
}
