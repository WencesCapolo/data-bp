import { NextRequest, NextResponse } from 'next/server';
import { getSessionCookie } from 'better-auth/cookies';
import { swapToPortal, buildPortalLoginUrl } from '@/lib/auth/portal';

const PUBLIC_API = new Set(['/api/basket/sync']);

export function proxy(req: NextRequest) {
  const { pathname } = req.nextUrl;

  // Sync POST is protected by x-sync-token header, not session.
  if (pathname.startsWith('/api/basket/sync')) return NextResponse.next();
  if (PUBLIC_API.has(pathname)) return NextResponse.next();

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

  const session = getSessionCookie(req);

  if (!session) {
    if (pathname.startsWith('/api/')) {
      return NextResponse.json({ error: 'unauthorized' }, { status: 401 });
    }
    // SSO: bounce to the portal login, preserving the analytics deep link so the
    // user lands back here after authenticating. Use BETTER_AUTH_URL for an https
    // origin (the proxied request scheme may be http behind nginx).
    const analyticsBase = process.env.BETTER_AUTH_URL ?? req.nextUrl.origin;
    const portalBase = process.env.PORTAL_BASE_URL ?? swapToPortal(analyticsBase);
    const redirectTo = `${analyticsBase.replace(/\/$/, '')}${pathname}${req.nextUrl.search}`;
    return NextResponse.redirect(buildPortalLoginUrl(portalBase, redirectTo));
  }

  return NextResponse.next();
}

export const config = {
  matcher: [
    '/',
    '/basket/:path*',
    '/admin/:path*',
    '/api/basket/:path*',
    '/api/admin/:path*',
  ],
};
