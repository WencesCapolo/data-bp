import { NextResponse, type NextRequest } from 'next/server';
import { getSessionCookie } from 'better-auth/cookies';

const PUBLIC_PREFIXES = ['/api/auth', '/sign-in', '/_next', '/favicon', '/fonts'];

function isPublic(pathname: string): boolean {
  return PUBLIC_PREFIXES.some((p) => pathname.startsWith(p));
}

export function middleware(req: NextRequest) {
  const { pathname } = req.nextUrl;

  if (isPublic(pathname)) return NextResponse.next();

  if (pathname.startsWith('/api/basket/sync')) {
    const expected = process.env.SYNC_TOKEN;
    const got = req.headers.get('x-sync-token');
    if (expected && got === expected) return NextResponse.next();
  }

  const session = getSessionCookie(req);
  if (session) return NextResponse.next();

  if (pathname.startsWith('/api/')) {
    return NextResponse.json({ error: 'unauthorized' }, { status: 401 });
  }

  const url = req.nextUrl.clone();
  url.pathname = '/sign-in';
  url.search = '';
  return NextResponse.redirect(url);
}

export const config = {
  matcher: ['/basket/:path*', '/api/basket/:path*', '/'],
};
