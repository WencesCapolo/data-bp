import { flush } from './telemetry';

const SIGNAL_EXIT_CODES = { SIGTERM: 143, SIGINT: 130 } as const;
const REGISTERED = Symbol.for('analytics.telemetryShutdown');

/**
 * On SIGTERM/SIGINT (pm2 restart, deploy) send what the reporter still has
 * queued (≤ 1.5 s), so the errors of the last second are not lost. Node only:
 * loaded from `register()` in `src/instrumentation.ts`. Our listener replaces
 * Node's default exit, so when nothing else listens for the signal this exits
 * after the flush with the usual signal code.
 */
export function flushTelemetryOnShutdown(): void {
  const g = globalThis as typeof globalThis & { [REGISTERED]?: true };
  if (g[REGISTERED]) return;
  g[REGISTERED] = true;

  for (const signal of Object.keys(SIGNAL_EXIT_CODES) as (keyof typeof SIGNAL_EXIT_CODES)[]) {
    process.once(signal, () => {
      void flush().finally(() => {
        if (process.listenerCount(signal) === 0) process.exit(SIGNAL_EXIT_CODES[signal]);
      });
    });
  }
}
