import { describe, expect, it } from 'vitest';
import { resolveProxyRedirect } from '@/lib/auth/proxy-redirect';

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
