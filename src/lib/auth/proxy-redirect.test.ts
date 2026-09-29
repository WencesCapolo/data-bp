import { describe, expect, it } from 'vitest';
import { publicRequestUrl, resolveProxyRedirect } from '@/lib/auth/proxy-redirect';

const PORTAL = 'https://portal.basket-app.com';

describe('resolveProxyRedirect', () => {
  it('sends a page request without session cookie to the portal login with the full requested URL', () => {
    expect(
      resolveProxyRedirect({ hasSessionCookie: false, requestUrl: 'https://analytics.basket-app.com/basket?tab=teams', portalUrl: PORTAL }),
    ).toEqual({ kind: 'redirect', to: `${PORTAL}/login?redirectTo=${encodeURIComponent('https://analytics.basket-app.com/basket?tab=teams')}` });
  });

  it('answers 401 for an API request without session cookie instead of redirecting', () => {
    expect(
      resolveProxyRedirect({ hasSessionCookie: false, requestUrl: 'https://analytics.basket-app.com/api/basket/overview', portalUrl: PORTAL }),
    ).toEqual({ kind: 'unauthorized' });
  });

  it('lets a request with a session cookie through', () => {
    expect(resolveProxyRedirect({ hasSessionCookie: true, requestUrl: 'https://analytics.basket-app.com/basket', portalUrl: PORTAL })).toBeNull();
  });
});

describe('publicRequestUrl', () => {
  it('rebuilds the URL from the forwarded Host, not the listen address', () => {
    expect(publicRequestUrl({ requestUrl: 'http://localhost:3001/basket?tab=teams', host: 'analytics.basket-app.com' })).toBe(
      'https://analytics.basket-app.com/basket?tab=teams',
    );
  });

  it('keeps http for a localhost Host', () => {
    expect(publicRequestUrl({ requestUrl: 'http://localhost:3001/basket', host: 'localhost:3001' })).toBe('http://localhost:3001/basket');
  });

  it('falls back to the request URL without a Host', () => {
    expect(publicRequestUrl({ requestUrl: 'http://localhost:3001/basket', host: null })).toBe('http://localhost:3001/basket');
  });
});
