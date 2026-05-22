import { NextRequest, NextResponse } from 'next/server';
import { getSessionCookie } from 'better-auth/cookies';

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
    const url = req.nextUrl.clone();
    url.pathname = '/sign-in';
    url.search = '';
    return NextResponse.redirect(url);
  }

  return NextResponse.next();
}

export const config = {
  matcher: ['/basket/:path*', '/api/basket/:path*'],
};
