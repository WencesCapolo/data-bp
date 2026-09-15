import { NextRequest, NextResponse } from 'next/server';
import { getSessionCookie } from 'better-auth/cookies';
import { resolveProxyRedirect } from '@/lib/auth/proxy-redirect';
import { authEnv } from '@/lib/env';

const PUBLIC_API = new Set(['/api/basket/sync']);

// Optimistic cookie-presence check, like the portal's middleware. Session
// validity and the analytics Acceso are read per request in requireSession /
// getSessionUser, so every API route still gates itself.
export function proxy(req: NextRequest) {
  const { pathname } = req.nextUrl;

  // Sync POST is protected by x-sync-token header, not session.
  if (pathname.startsWith('/api/basket/sync')) return NextResponse.next();
  if (PUBLIC_API.has(pathname)) return NextResponse.next();

  // Automation bypass for /api/sync: the route authenticates the same header
  // itself, so this only lets the request reach it. A session is equally
  // sufficient — this is an extra door, not the only one.
  const syncToken = process.env.SYNC_TOKEN;
  if (syncToken && req.headers.get('x-sync-token') === syncToken) {
    return NextResponse.next();
  }

  // Internal/smoke bypass: only honored when NODE_ENV !== 'production'
  // and INTERNAL_API_TOKEN is set + matches the header.
  const internal = process.env.INTERNAL_API_TOKEN;
  if (
    process.env.NODE_ENV !== 'production' &&
    internal &&
    req.headers.get('x-internal-token') === internal
  ) {
    return NextResponse.next();
  }

  const decision = resolveProxyRedirect({
    hasSessionCookie: Boolean(getSessionCookie(req)),
    requestUrl: req.url,
    portalUrl: authEnv.portalUrl,
  });
  if (decision?.kind === 'unauthorized') {
    return NextResponse.json({ error: 'unauthorized' }, { status: 401 });
  }
  if (decision?.kind === 'redirect') return NextResponse.redirect(decision.to);

  // Pages need the URL they were asked for to build their own login redirect.
  const requestHeaders = new Headers(req.headers);
  requestHeaders.set('x-url', req.url);
  return NextResponse.next({ request: { headers: requestHeaders } });
}

export const config = {
  matcher: [
    '/',
    '/basket/:path*',
    '/partidos/:path*',
    '/financiero/:path*',
    '/api/basket/:path*',
    '/api/partidos/:path*',
    // /financiero guards itself with requireDashboard, but its API did not and
    // is not under /api/basket — so it answered 200 with the whole Economía DTO
    // to anyone who asked. The page being protected says nothing about the
    // endpoint behind it.
    '/api/financiero/:path*',
    // Sync writes to the mirror and consumes an Upload; it must not be
    // reachable unauthenticated. /api/basket/sync stays exempt above for the
    // token-authenticated automation, /api/sync deliberately is not.
    '/api/sync',
    '/api/sync/:path*',
  ],
};
