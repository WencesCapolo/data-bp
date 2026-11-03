import type { Instrumentation } from 'next';
import { reportServerError } from '@/lib/telemetry';

// Flush the telemetry queue on SIGTERM/SIGINT. Node runtime only: the import
// stays out of the Edge bundle.
export async function register(): Promise<void> {
  if (process.env.NEXT_RUNTIME === 'nodejs') {
    const { flushTelemetryOnShutdown } = await import('@/lib/telemetry-shutdown');
    flushTelemetryOnShutdown();
  }
}

// Every error Next catches on the server (pages, route handlers, actions, proxy)
// goes to basket-telemetry. reportServerError only queues, so nothing waits here.
// Errors a handler catches itself are reported where it catches them
// (serverError, the syncs): see docs/telemetry.md.
export const onRequestError: Instrumentation.onRequestError = (err, request, context) => {
  reportServerError(err, { method: request.method, route: context.routePath, routeType: context.routeType });
};
