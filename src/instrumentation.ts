import type { Instrumentation } from 'next';
import { requestIdOf } from 'basket-tv-telemetry/log';
import { telemetry } from '@/lib/telemetry';

// Once per server start, Node runtime only (the imports stay out of the Edge
// bundle): flush the telemetry queue on SIGTERM/SIGINT, and start the 6-hourly
// Sync. The Sync used to start from the root layout, so after a restart it did
// not run until someone opened a page: a deploy with no visitors left Stripe
// and the Mercado Pago inbox unsynced.
export async function register(): Promise<void> {
  if (process.env.NEXT_RUNTIME === 'nodejs') {
    const { flushTelemetryOnShutdown } = await import('@/lib/telemetry-shutdown');
    flushTelemetryOnShutdown();
    const { startSyncScheduler } = await import('@basket/infrastructure/cron/SyncScheduler');
    startSyncScheduler();
  }
}

// Every error Next catches on the server (pages, route handlers, actions, proxy)
// goes to basket-telemetry, with the request id of the line withRequestLog wrote.
// reportServerError only queues, so nothing waits here. Errors a handler catches
// itself are reported where it catches them (serverError, the syncs): see
// docs/telemetry.md.
export const onRequestError: Instrumentation.onRequestError = (err, request, context) => {
  telemetry.reportServerError(err, {
    method: request.method,
    route: context.routePath,
    route_type: context.routeType,
    request_id: requestIdOf(err),
  });
};
