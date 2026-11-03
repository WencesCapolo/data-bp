import { NextResponse } from 'next/server';
import { createHash } from 'node:crypto';
import type { NextRequest } from 'next/server';
import type { ZodError } from 'zod';
import { reportUnexpected } from '@/lib/reportError';

const NO_STORE = { 'cache-control': 'no-store' };

export function ok<T>(data: T, extraHeaders: Record<string, string> = {}): NextResponse {
  return NextResponse.json(data, { headers: { ...NO_STORE, ...extraHeaders } });
}

export function okCached<T>(
  req: NextRequest,
  data: T,
  opts: { maxAge: number; staleWhileRevalidate?: number } = { maxAge: 60 },
): NextResponse {
  const body = JSON.stringify(data);
  const etag = `W/"${createHash('sha1').update(body).digest('base64url').slice(0, 16)}"`;
  const ifNoneMatch = req.headers.get('if-none-match');
  const cacheControl =
    `private, max-age=${opts.maxAge}` +
    (opts.staleWhileRevalidate ? `, stale-while-revalidate=${opts.staleWhileRevalidate}` : '');
  if (ifNoneMatch && ifNoneMatch === etag) {
    return new NextResponse(null, { status: 304, headers: { etag, 'cache-control': cacheControl } });
  }
  return new NextResponse(body, {
    headers: { 'content-type': 'application/json', etag, 'cache-control': cacheControl },
  });
}

export function badRequest(err: ZodError): NextResponse {
  return NextResponse.json(
    { error: 'invalid_query', issues: err.issues },
    { status: 400, headers: NO_STORE },
  );
}

// API routes answer 401 JSON, never a redirect: a fetch cannot follow the
// portal login page. The proxy only checks cookie presence, so this is the
// gate that actually reads the session and the analytics Acceso.
export function unauthorized(): NextResponse {
  return NextResponse.json({ error: 'unauthorized' }, { status: 401, headers: NO_STORE });
}

export interface ServerErrorContext {
  method: string;
  /** The route pattern (`/api/basket/teams/[teamId]/daily`), never the URL; or a job name. */
  route: string;
  /** `route` unless the handler runs a background job (`job`). */
  routeType?: 'route' | 'job';
}

/**
 * The 500 for an unexpected error: a generic body, one scrubbed log line and one
 * report to basket-telemetry (catching it here means `onRequestError` never sees
 * it). The stack is answered only outside production, for local debugging.
 */
export function serverError(err: unknown, ctx: ServerErrorContext): NextResponse {
  reportUnexpected('api', err, { method: ctx.method, route: ctx.route, routeType: ctx.routeType ?? 'route', status: 500 });
  const stack = process.env.NODE_ENV !== 'production' && err instanceof Error ? err.stack : undefined;
  return NextResponse.json(
    { error: 'internal_error', ...(stack ? { stack } : {}) },
    { status: 500, headers: NO_STORE },
  );
}
