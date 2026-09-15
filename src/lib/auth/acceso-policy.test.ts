import { describe, expect, it } from 'vitest';
import { portalLoginUrl, resolveSessionUser } from '@/lib/auth/acceso-policy';

const PORTAL = 'https://portal.basket-app.com';
const session = { id: 'u1', email: 'ana@basquetpass.tv', name: 'Ana', image: null };

describe('resolveSessionUser', () => {
  it('sends a visitor without session to the portal login with the requested URL', () => {
    expect(
      resolveSessionUser({ session: null, acceso: null, returnTo: 'https://analytics.basket-app.com/basket?tab=teams', portalUrl: PORTAL }),
    ).toEqual({ kind: 'login', to: `${PORTAL}/login?redirectTo=${encodeURIComponent('https://analytics.basket-app.com/basket?tab=teams')}` });
  });

  it('sends a session without analytics Acceso to the portal no-access page', () => {
    expect(resolveSessionUser({ session, acceso: null, returnTo: '', portalUrl: PORTAL })).toEqual({
      kind: 'no-access',
      to: `${PORTAL}/no-access`,
    });
  });

  it('maps Nivel admin to role admin', () => {
    expect(resolveSessionUser({ session, acceso: { level: 'admin' }, returnTo: '', portalUrl: PORTAL })).toEqual({
      kind: 'allow',
      user: { ...session, role: 'admin' },
    });
  });

  it.each(['read', 'write'] as const)('maps Nivel %s to role viewer', (level) => {
    expect(resolveSessionUser({ session, acceso: { level }, returnTo: '', portalUrl: PORTAL })).toEqual({
      kind: 'allow',
      user: { ...session, role: 'viewer' },
    });
  });
});

describe('portalLoginUrl', () => {
  it('omits redirectTo when there is no return URL', () => {
    expect(portalLoginUrl(PORTAL, '')).toBe(`${PORTAL}/login`);
  });
});
