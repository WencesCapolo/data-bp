import type { Instrumentation } from 'next';
import { reportServerError } from '@/lib/telemetry';

// Every error Next catches on the server (pages, route handlers, actions, proxy)
// goes to basket-telemetry. reportServerError only queues, so nothing waits here.
export const onRequestError: Instrumentation.onRequestError = (err, request, context) => {
  reportServerError(err, { method: request.method, route: context.routePath, routeType: context.routeType });
};
