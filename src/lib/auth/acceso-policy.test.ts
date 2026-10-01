import { describe, expect, it } from 'vitest';
import { lanzadorUrlFor, portalLoginUrl, resolveSessionUser } from '@/lib/auth/acceso-policy';

const PORTAL = 'https://portal.basket-app.com';
const session = { id: 'u1', email: 'ana@basquetpass.tv', name: 'Ana', image: null };

describe('resolveSessionUser', () => {
  it('sends a visitor without session to the portal login with the requested URL', () => {
    expect(
      resolveSessionUser({ session: null, acceso: null, returnTo: 'https://analytics.basket-app.com/basket?tab=teams', portalUrl: PORTAL }),
    ).toEqual({ kind: 'login', to: `${PORTAL}/login?redirectTo=${encodeURIComponent('https://analytics.basket-app.com/basket?tab=teams')}` });
  });

  it('sends a session without analytics Acceso to the portal Solicitud form for analytics', () => {
    expect(resolveSessionUser({ session, acceso: null, returnTo: '', portalUrl: PORTAL })).toEqual({
      kind: 'no-access',
      to: `${PORTAL}/no-access?app=analytics`,
    });
  });

  it('maps catalog role admin (also what a super admin resolves to) to role admin', () => {
    expect(resolveSessionUser({ session, acceso: { role: 'admin' }, returnTo: '', portalUrl: PORTAL })).toEqual({
      kind: 'allow',
      user: { ...session, role: 'admin' },
    });
  });

  it.each(['read', 'write'] as const)('maps catalog role %s to role viewer', (role) => {
    expect(resolveSessionUser({ session, acceso: { role }, returnTo: '', portalUrl: PORTAL })).toEqual({
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

describe('lanzadorUrlFor', () => {
  it('hides the way back for someone with only this app', () => {
    expect(lanzadorUrlFor({ appCount: 1, portalUrl: PORTAL })).toBeNull();
  });

  it('points at the apex directory for someone with two or more apps', () => {
    expect(lanzadorUrlFor({ appCount: 2, portalUrl: PORTAL })).toBe('https://basket-app.com');
  });
});
